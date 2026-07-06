import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { UpdateTenantSettingsDto } from './dto/tenant-settings.dto';

@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        isActive: true,
        whatsappPhoneNumberId: true,
        whatsappProvider: true,
        woocommerceUrl: true,
        woocommerceProvider: true,
        aiConfidenceThreshold: true,
        autoApproveEnabled: true,
        autoApproveThreshold: true,
        businessHours: true,
        // We omit access tokens and secrets from the response for security
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Restricted credentials (SECURITY.md §3/§12/§20) are encrypted at the
    // application layer before persistence. Non-secret fields are stored as-is.
    const updatedTenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.whatsappPhoneNumberId !== undefined && { whatsappPhoneNumberId: dto.whatsappPhoneNumberId }),
        ...(dto.whatsappAccessToken !== undefined && {
          whatsappAccessToken: this.encryption.encryptNullable(dto.whatsappAccessToken),
        }),
        ...(dto.whatsappVerifyToken !== undefined && {
          whatsappVerifyToken: this.encryption.encryptNullable(dto.whatsappVerifyToken),
        }),
        ...(dto.woocommerceUrl !== undefined && { woocommerceUrl: dto.woocommerceUrl }),
        ...(dto.woocommerceKey !== undefined && {
          woocommerceKey: this.encryption.encryptNullable(dto.woocommerceKey),
        }),
        ...(dto.woocommerceSecret !== undefined && {
          woocommerceSecret: this.encryption.encryptNullable(dto.woocommerceSecret),
        }),
        ...(dto.aiConfidenceThreshold !== undefined && { aiConfidenceThreshold: dto.aiConfidenceThreshold }),
        ...(dto.autoApproveEnabled !== undefined && { autoApproveEnabled: dto.autoApproveEnabled }),
        ...(dto.autoApproveThreshold !== undefined && { autoApproveThreshold: dto.autoApproveThreshold }),
        ...(dto.businessHours !== undefined && { businessHours: dto.businessHours }),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        isActive: true,
        whatsappPhoneNumberId: true,
        whatsappProvider: true,
        woocommerceUrl: true,
        woocommerceProvider: true,
        aiConfidenceThreshold: true,
        autoApproveEnabled: true,
        autoApproveThreshold: true,
        businessHours: true,
      },
    });

    return updatedTenant;
  }
}
