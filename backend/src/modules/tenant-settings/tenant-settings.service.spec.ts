import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TenantSettingsService } from './tenant-settings.service';
import { PrismaService } from '../../common/database/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { NotFoundException } from '@nestjs/common';

describe('TenantSettingsService', () => {
  let service: TenantSettingsService;
  let encryption: EncryptionService;

  const mockPrisma = {
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  // Real EncryptionService with a deterministic test key so we can assert
  // that credentials are actually encrypted (not merely mocked away).
  const configService = {
    get: (name: string) => (name === 'ENCRYPTION_KEY' ? 'f'.repeat(64) : undefined),
  } as unknown as ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: configService },
        EncryptionService,
      ],
    }).compile();

    service = module.get<TenantSettingsService>(TenantSettingsService);
    encryption = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('should return tenant settings excluding secrets', async () => {
      const mockTenant = {
        id: 'tenant-1',
        name: 'Test Store',
        slug: 'test-store',
        plan: 'STARTER',
        isActive: true,
        whatsappPhoneNumberId: 'phone-123',
        whatsappProvider: 'MOCK',
        woocommerceUrl: null,
        woocommerceProvider: 'MOCK',
        aiConfidenceThreshold: 0.85,
        autoApproveEnabled: false,
        autoApproveThreshold: 0.95,
        businessHours: null,
      };
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);

      const result = await service.getSettings('tenant-1');

      expect(result).toEqual(mockTenant);
      // Verify secrets are NOT in the response
      expect(result).not.toHaveProperty('whatsappAccessToken');
      expect(result).not.toHaveProperty('woocommerceKey');
      expect(result).not.toHaveProperty('woocommerceSecret');
    });

    it('should throw NotFoundException for unknown tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.getSettings('nonexistent-tenant'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings', async () => {
      const mockTenant = { id: 'tenant-1', name: 'Old Name' };
      const updatedTenant = {
        id: 'tenant-1',
        name: 'New Name',
        slug: 'test-store',
        plan: 'STARTER',
        isActive: true,
        whatsappPhoneNumberId: null,
        whatsappProvider: 'MOCK',
        woocommerceUrl: null,
        woocommerceProvider: 'MOCK',
        aiConfidenceThreshold: 0.90,
        autoApproveEnabled: true,
        autoApproveThreshold: 0.95,
        businessHours: null,
      };

      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.tenant.update.mockResolvedValue(updatedTenant);

      const result = await service.updateSettings('tenant-1', {
        name: 'New Name',
        aiConfidenceThreshold: 0.90,
        autoApproveEnabled: true,
      });

      expect(result.name).toBe('New Name');
      expect(result.aiConfidenceThreshold).toBe(0.90);
      expect(result.autoApproveEnabled).toBe(true);
    });

    it('should throw NotFoundException for unknown tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSettings('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('encrypts restricted credentials before persistence (never plaintext)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.tenant.update.mockResolvedValue({});

      const plaintextKey = 'ck_live_consumer_key_123';
      const plaintextSecret = 'cs_live_consumer_secret_456';

      await service.updateSettings('tenant-1', {
        woocommerceKey: plaintextKey,
        woocommerceSecret: plaintextSecret,
        whatsappAccessToken: 'EAAG_whatsapp_token',
      });

      const data = mockPrisma.tenant.update.mock.calls[0][0].data;

      // Stored values must NOT equal the plaintext...
      expect(data.woocommerceKey).not.toBe(plaintextKey);
      expect(data.woocommerceSecret).not.toBe(plaintextSecret);
      // ...must be in the versioned encrypted envelope...
      expect(encryption.isEncrypted(data.woocommerceKey)).toBe(true);
      expect(encryption.isEncrypted(data.woocommerceSecret)).toBe(true);
      expect(encryption.isEncrypted(data.whatsappAccessToken)).toBe(true);
      // ...and must decrypt back to the original.
      expect(encryption.decrypt(data.woocommerceKey)).toBe(plaintextKey);
      expect(encryption.decrypt(data.woocommerceSecret)).toBe(plaintextSecret);
    });

    it('should only update provided fields', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.tenant.update.mockResolvedValue({});

      await service.updateSettings('tenant-1', {
        aiConfidenceThreshold: 0.8,
      });

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aiConfidenceThreshold: 0.8,
          }),
        }),
      );

      // Should NOT contain name since it wasn't provided
      const callArg = mockPrisma.tenant.update.mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty('name');
    });
  });
});
