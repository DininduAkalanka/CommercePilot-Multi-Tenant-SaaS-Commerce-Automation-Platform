import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { ProductRetrieverService } from '../ai-engine/pipeline/product-retriever.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductVariantService } from './product-variant.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productRetriever: ProductRetrieverService,
    private readonly variants: ProductVariantService,
  ) {}

  async createProduct(tenantId: string, dto: CreateProductDto) {
    const id = uuidv4();

    const product = await this.prisma.product.create({
      data: {
        id,
        tenantId,
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        price: dto.price,
        stockQuantity: dto.stockQuantity,
        attributes: dto.attributes ?? {},
        isActive: true,
      },
    });

    // Dual-write (Phase 1 PR2). Nothing reads variants yet; this keeps the
    // mirror in step so PR3 can switch reads over without a data migration.
    await this.variants.ensureDefaultVariant(
      tenantId,
      product.id,
      product.stockQuantity,
    );

    this.logger.log(`[${tenantId}] Product created: ${product.id}`);

    // Audit log: product created
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorType: 'USER',
        action: 'PRODUCT_CREATED',
        entityType: 'Product',
        entityId: product.id,
        afterState: { name: product.name, sku: dto.sku, price: dto.price },
      },
    });

    // Generate pgvector embedding for RAG asynchronously
    this.productRetriever
      .generateAndStoreEmbedding(product.id, tenantId)
      .catch((err) => {
        this.logger.error(
          `Failed to generate embedding for ${product.id}`,
          err,
        );
      });

    return product;
  }

  async getProducts(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({
        where: { tenantId, deletedAt: null },
      }),
    ]);

    return {
      products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    const product = await this.getProduct(tenantId, id);

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        name: dto.name,
        description: dto.description,
        sku: dto.sku,
        price: dto.price,
        stockQuantity: dto.stockQuantity,
        attributes: dto.attributes,
      },
    });

    // Dual-write (Phase 1 PR2). Nothing reads variants yet; this keeps the
    // mirror in step so PR3 can switch reads over without a data migration.
    await this.variants.ensureDefaultVariant(
      tenantId,
      updated.id,
      updated.stockQuantity,
    );

    this.logger.log(`[${tenantId}] Product updated: ${updated.id}`);

    // Audit log: product updated
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorType: 'USER',
        action: 'PRODUCT_UPDATED',
        entityType: 'Product',
        entityId: updated.id,
        beforeState: { name: product.name },
        afterState: { name: updated.name, price: updated.price },
      },
    });

    // Regenerate pgvector embedding for RAG asynchronously
    this.productRetriever
      .generateAndStoreEmbedding(updated.id, tenantId)
      .catch((err) => {
        this.logger.error(
          `Failed to generate embedding for ${updated.id}`,
          err,
        );
      });

    return updated;
  }

  async deleteProduct(tenantId: string, id: string) {
    const product = await this.getProduct(tenantId, id);

    // Soft delete via PrismaService helper
    await this.prisma.softDelete('product', { id: product.id });

    this.logger.log(`[${tenantId}] Product deleted: ${product.id}`);

    // Audit log: product deleted (soft)
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorType: 'USER',
        action: 'PRODUCT_DELETED',
        entityType: 'Product',
        entityId: product.id,
        afterState: { name: product.name, deletedAt: new Date().toISOString() },
      },
    });

    return { success: true, message: 'Product deleted successfully' };
  }
}
