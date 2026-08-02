import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HumanHandoffService } from './human-handoff.service';
import {
  ConversationStateService,
  ConversationSession,
} from './conversation-state.service';
import { ConversationStage } from '@prisma/client';

describe('HumanHandoffService', () => {
  let service: HumanHandoffService;

  const mockState = {
    getSession: jest.fn(),
    saveSession: jest.fn(),
  };
  const mockEmitter = { emit: jest.fn() };
  let config: Record<string, string>;

  const mockConfig = {
    get: jest.fn((key: string, def?: string) => config[key] ?? def),
  };

  const session = (over: Partial<ConversationSession> = {}) => ({
    conversationId: 'conv-1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    phone: '+94771234567',
    stage: ConversationStage.GATHERING_INFO,
    messageHistory: [],
    partialOrderData: {},
    missingFields: ['size'],
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(async () => {
    config = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HumanHandoffService,
        { provide: ConversationStateService, useValue: mockState },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEmitter },
      ],
    }).compile();

    service = module.get<HumanHandoffService>(HumanHandoffService);
    mockState.saveSession.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('escalation threshold', () => {
    it('does not escalate before the limit', async () => {
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 1 }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        false,
      );
    });

    it('escalates once the limit is reached', async () => {
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 2 }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        true,
      );
    });

    it('honours a configured limit', async () => {
      config.HANDOFF_MAX_CLARIFICATIONS = '4';
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 3 }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        false,
      );
    });

    it('falls back to the default when the limit is misconfigured', async () => {
      config.HANDOFF_MAX_CLARIFICATIONS = 'not-a-number';
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 2 }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        true,
      );
    });

    it('stays escalated once handed off, even below the limit', async () => {
      // The owner may be mid-reply; the AI must not start talking over them.
      mockState.getSession.mockResolvedValue(
        session({
          clarificationAttempts: 0,
          handedOffAt: new Date().toISOString(),
        }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        true,
      );
    });
  });

  describe('kill switch', () => {
    it('never escalates when disabled — previous behaviour exactly', async () => {
      config.HANDOFF_ENABLED = 'false';
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 99 }),
      );

      expect(await service.shouldEscalate('tenant-1', '+94771234567')).toBe(
        false,
      );
    });
  });

  describe('backward compatibility', () => {
    it('treats a session stored before this feature as zero attempts', async () => {
      // Sessions already in Redis were serialised without the field.
      const legacy = session();
      delete (legacy as Partial<ConversationSession>).clarificationAttempts;
      mockState.getSession.mockResolvedValue(legacy);

      const state = await service.getState('tenant-1', '+94771234567');

      expect(state.attempts).toBe(0);
      expect(state.handedOff).toBe(false);
    });

    it('reports no state at all when the session has expired', async () => {
      mockState.getSession.mockResolvedValue(null);

      expect(await service.getState('tenant-1', '+94771234567')).toEqual({
        attempts: 0,
        handedOff: false,
      });
    });
  });

  describe('registerClarification', () => {
    it('increments and persists the counter', async () => {
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 1 }),
      );

      const count = await service.registerClarification(
        'tenant-1',
        '+94771234567',
      );

      expect(count).toBe(2);
      expect(mockState.saveSession).toHaveBeenCalledWith(
        'tenant-1',
        '+94771234567',
        expect.objectContaining({ clarificationAttempts: 2 }),
      );
    });

    it('does nothing when the session has expired', async () => {
      mockState.getSession.mockResolvedValue(null);

      expect(
        await service.registerClarification('tenant-1', '+94771234567'),
      ).toBe(0);
      expect(mockState.saveSession).not.toHaveBeenCalled();
    });
  });

  describe('escalate', () => {
    it('marks the session and emits the event once', async () => {
      mockState.getSession.mockResolvedValue(
        session({ clarificationAttempts: 2 }),
      );

      const first = await service.escalate(
        'tenant-1',
        '+94771234567',
        'stuck',
        {
          customerMessage: 'mata ekak one',
          missingFields: ['product'],
        },
      );

      expect(first).toBe(true);
      expect(mockState.saveSession).toHaveBeenCalledWith(
        'tenant-1',
        '+94771234567',
        expect.objectContaining({ handedOffAt: expect.any(String) }),
      );
      expect(mockEmitter.emit).toHaveBeenCalledWith(
        'conversation.handoff_requested',
        expect.objectContaining({
          tenantId: 'tenant-1',
          phone: '+94771234567',
          reason: 'stuck',
          customerMessage: 'mata ekak one',
          missingFields: ['product'],
        }),
      );
    });

    it('is idempotent — a customer who keeps typing cannot spam the owner', async () => {
      mockState.getSession.mockResolvedValue(
        session({ handedOffAt: new Date().toISOString() }),
      );

      const again = await service.escalate('tenant-1', '+94771234567', 'stuck');

      expect(again).toBe(false);
      expect(mockEmitter.emit).not.toHaveBeenCalled();
      expect(mockState.saveSession).not.toHaveBeenCalled();
    });

    it('does nothing when the session has expired', async () => {
      mockState.getSession.mockResolvedValue(null);

      expect(await service.escalate('tenant-1', '+94771234567', 'stuck')).toBe(
        false,
      );
      expect(mockEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('customer message', () => {
    it('promises a human without claiming to be one', () => {
      const msg = service.buildCustomerMessage();

      expect(msg.toLowerCase()).toContain('team');
      // Must not hand out a phone number — the customer is already in the chat,
      // and sending them elsewhere discards the conversation context.
      expect(msg).not.toMatch(/\+?\d{7,}/);
    });
  });
});
