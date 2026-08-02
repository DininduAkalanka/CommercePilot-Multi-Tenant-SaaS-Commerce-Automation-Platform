import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AiEngineService } from '../ai-engine/ai-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConfigService } from '@nestjs/config';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { getQueueToken } from '@nestjs/bull';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  const mockPrisma = {
    tenant: {
      findFirst: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    whatsAppMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockAiEngine = {
    processWhatsAppMessage: jest.fn(),
  };

  const mockConversationsService = {
    getOrCreateSession: jest.fn(),
    updateSessionState: jest.fn(),
    processMessageInConversation: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal?: any) => {
      const config: Record<string, any> = {
        WHATSAPP_PROVIDER: 'mock',
        WHATSAPP_APP_SECRET: 'test-secret',
      };
      return config[key] ?? defaultVal;
    }),
  };

  const mockWhatsAppAdapter = {
    sendTextMessage: jest.fn().mockResolvedValue(undefined),
    simulateIncomingMessage: jest
      .fn()
      .mockReturnValue({ messageId: 'sim-msg-1' }),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiEngineService, useValue: mockAiEngine },
        { provide: ConversationsService, useValue: mockConversationsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WHATSAPP_ADAPTER, useValue: mockWhatsAppAdapter },
        { provide: getQueueToken('message-processing'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Webhook signature verification (provider = 'meta') ──────────────
  //
  // Regression: the HMAC was computed over `JSON.stringify(parsedBody)`
  // instead of the raw request bytes. Re-serialising changes key order,
  // unicode escaping and whitespace, so the digest could never match real
  // Meta traffic. The failure was invisible because the caller swallowed the
  // exception and returned 200 — every genuine order would have been dropped.
  describe('handleIncomingWebhook — signature verification', () => {
    const APP_SECRET = 'test-secret';

    // A body whose re-serialisation differs from the bytes actually signed:
    // extra whitespace and an escaped unicode sequence.
    const RAW = Buffer.from(
      '{"object":"whatsapp_business_account",  "entry":[{"id":"\\u0041"}]}',
      'utf8',
    );

    const sign = (body: Buffer, secret = APP_SECRET) =>
      'sha256=' +
      crypto.createHmac('sha256', secret).update(body).digest('hex');

    // Switch the provider to 'meta' so verification actually runs, then put
    // it back — otherwise the override leaks into the mock-mode tests below.
    const mockModeImpl = mockConfigService.get.getMockImplementation();

    beforeEach(() => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultVal?: any) => {
          const config: Record<string, any> = {
            WHATSAPP_PROVIDER: 'meta',
            WHATSAPP_APP_SECRET: APP_SECRET,
          };
          return config[key] ?? defaultVal;
        },
      );
    });

    afterEach(() => {
      if (mockModeImpl) {
        mockConfigService.get.mockImplementation(mockModeImpl);
      }
    });

    it('accepts a signature computed over the RAW body', async () => {
      const payload = JSON.parse(RAW.toString('utf8'));

      await expect(
        service.handleIncomingWebhook(payload, sign(RAW), RAW),
      ).resolves.toBeUndefined();
    });

    it('rejects a signature computed over the re-serialised body (the old bug)', async () => {
      const payload = JSON.parse(RAW.toString('utf8'));
      const reserialised = Buffer.from(JSON.stringify(payload), 'utf8');

      // Guard the premise: the two byte strings really do differ.
      expect(reserialised.equals(RAW)).toBe(false);

      await expect(
        service.handleIncomingWebhook(payload, sign(reserialised), RAW),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a signature made with the wrong secret', async () => {
      const payload = JSON.parse(RAW.toString('utf8'));

      await expect(
        service.handleIncomingWebhook(payload, sign(RAW, 'wrong-secret'), RAW),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a short/malformed signature without throwing RangeError', async () => {
      const payload = JSON.parse(RAW.toString('utf8'));

      // timingSafeEqual throws RangeError on length mismatch; that must be
      // caught by the length check and surface as 403, not a 500.
      await expect(
        service.handleIncomingWebhook(payload, 'sha256=ab', RAW),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the raw body is unavailable (fails closed)', async () => {
      const payload = JSON.parse(RAW.toString('utf8'));

      await expect(
        service.handleIncomingWebhook(payload, sign(RAW), undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not process the payload when the signature is invalid', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'p1' },
                  messages: [{ id: 'm1', from: '+1', type: 'text' }],
                },
              },
            ],
          },
        ],
      };
      const raw = Buffer.from(JSON.stringify(payload), 'utf8');

      await expect(
        service.handleIncomingWebhook(payload, sign(raw, 'wrong'), raw),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('handleIncomingWebhook', () => {
    it('should ignore payloads with no entry', async () => {
      await service.handleIncomingWebhook({}, '');

      expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled();
    });

    it('should ignore payloads with no messages', async () => {
      const payload = {
        entry: [{ changes: [{ field: 'messages', value: { messages: [] } }] }],
      };

      await service.handleIncomingWebhook(payload, '');

      // No tenant lookup because messages array is empty
      expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled();
    });

    it('should skip if no tenant found for phone number ID', async () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'unknown-phone' },
                  messages: [
                    {
                      id: 'msg-1',
                      from: '+94771234567',
                      type: 'text',
                      text: { body: 'hi' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      mockPrisma.tenant.findFirst.mockResolvedValue(null);

      await service.handleIncomingWebhook(payload, '');

      expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            whatsappPhoneNumberId: 'unknown-phone',
            isActive: true,
          }),
        }),
      );
    });
  });

  describe('getSimulatorMessages', () => {
    it('should return recent messages for a tenant', async () => {
      const mockMessages = [
        { id: 'msg-1', tenantId: 'tenant-1', body: 'Hello' },
        { id: 'msg-2', tenantId: 'tenant-1', body: 'Order rice' },
      ];
      mockPrisma.whatsAppMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.getSimulatorMessages('tenant-1');

      expect(result).toEqual(mockMessages);
      expect(mockPrisma.whatsAppMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
          take: 50,
        }),
      );
    });
  });
});
