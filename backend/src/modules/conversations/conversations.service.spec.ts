import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../../common/database/prisma.service';
import { ConversationStateService } from './conversation-state.service';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockPrisma = {
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    whatsAppMessage: {
      findMany: jest.fn(),
    },
  };

  const mockConversationState = {
    getSession: jest.fn(),
    createSession: jest.fn(),
    addMessage: jest.fn(),
    updateStage: jest.fn(),
    deleteSession: jest.fn(),
    getRecentMessages: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConversationStateService, useValue: mockConversationState },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOrCreateConversation', () => {
    it('should return existing session from Redis if available', async () => {
      const existingSession = {
        conversationId: 'conv-1',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        phone: '+94771234567',
        stage: 'GREETING',
        messages: [],
      };

      mockConversationState.getSession.mockResolvedValue(existingSession);

      const result = await service.findOrCreateConversation(
        'tenant-1',
        'cust-1',
        '+94771234567',
      );

      expect(result.isNew).toBe(false);
      expect(result.conversation.id).toBe('conv-1');
      // Should NOT hit the DB since Redis had the session
      expect(mockPrisma.conversation.findFirst).not.toHaveBeenCalled();
    });

    it('should check DB if Redis session not found', async () => {
      mockConversationState.getSession.mockResolvedValue(null);
      mockPrisma.conversation.findFirst.mockResolvedValue(null);
      mockPrisma.conversation.create.mockResolvedValue({
        id: 'conv-new',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        phone: '+94771234567',
      });
      mockConversationState.createSession.mockResolvedValue({
        conversationId: 'conv-new',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        phone: '+94771234567',
        stage: 'GREETING',
        messages: [],
      });

      const result = await service.findOrCreateConversation(
        'tenant-1',
        'cust-1',
        '+94771234567',
      );

      expect(result.isNew).toBe(true);
      expect(mockPrisma.conversation.findFirst).toHaveBeenCalled();
      expect(mockPrisma.conversation.create).toHaveBeenCalled();
    });

    it('should hydrate from DB if active conversation exists but Redis expired', async () => {
      mockConversationState.getSession.mockResolvedValue(null);
      mockPrisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-old',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        phone: '+94771234567',
        stage: 'ORDERING',
      });

      mockConversationState.createSession.mockResolvedValue({
        conversationId: 'conv-old',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        phone: '+94771234567',
        stage: 'ORDERING',
        messages: [],
      });

      const result = await service.findOrCreateConversation(
        'tenant-1',
        'cust-1',
        '+94771234567',
      );

      expect(result.isNew).toBe(false);
      expect(result.conversation.id).toBe('conv-old');
      // Should recreate Redis session from DB
      expect(mockConversationState.createSession).toHaveBeenCalled();
    });
  });
});
