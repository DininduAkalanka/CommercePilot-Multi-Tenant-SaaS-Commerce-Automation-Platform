import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../common/database/prisma.service';
import { AiEngineService } from '../ai-engine/ai-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConfigService } from '@nestjs/config';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { getQueueToken } from '@nestjs/bull';

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
