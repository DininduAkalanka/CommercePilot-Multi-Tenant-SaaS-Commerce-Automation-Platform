import { Test, TestingModule } from '@nestjs/testing';
import { ProductVariantController } from './product-variant.controller';
import { ProductVariantService } from './product-variant.service';

/**
 * Written before the implementation.
 *
 * The controller is thin on purpose — every rule that matters (tenant
 * scoping, duplicate rejection, negative stock) already lives in the service
 * and is covered there. What these tests pin is the part a thin controller can
 * still get wrong: passing the caller's tenant rather than anything from the
 * request body or path, so a crafted request cannot reach another shop's
 * catalogue.
 */
describe('ProductVariantController', () => {
  let controller: ProductVariantController;

  const service = {
    create: jest.fn().mockResolvedValue({ id: 'v1' }),
    findByProduct: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'v1' }),
    remove: jest.fn().mockResolvedValue({ id: 'v1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductVariantController],
      providers: [{ provide: ProductVariantService, useValue: service }],
    }).compile();

    controller = module.get<ProductVariantController>(ProductVariantController);
  });

  afterEach(() => jest.clearAllMocks());

  it('lists variants scoped to the caller tenant', async () => {
    await controller.list('tenant-1', 'prod-1');

    expect(service.findByProduct).toHaveBeenCalledWith('tenant-1', 'prod-1');
  });

  it('creates using the caller tenant, never a value from the request', async () => {
    // The audit found two cross-tenant leaks from exactly this: trusting an id
    // that arrived with the request instead of the authenticated one.
    await controller.create('tenant-1', 'prod-1', {
      attributes: { size: 'L' },
      stockQuantity: 3,
    });

    expect(service.create).toHaveBeenCalledWith(
      'tenant-1',
      'prod-1',
      expect.objectContaining({ attributes: { size: 'L' }, stockQuantity: 3 }),
    );
  });

  it('updates using the caller tenant', async () => {
    await controller.update('tenant-1', 'prod-1', 'var-1', {
      stockQuantity: 7,
    });

    expect(service.update).toHaveBeenCalledWith(
      'tenant-1',
      'var-1',
      expect.objectContaining({ stockQuantity: 7 }),
    );
  });

  it('deletes using the caller tenant', async () => {
    await controller.remove('tenant-1', 'prod-1', 'var-1');

    expect(service.remove).toHaveBeenCalledWith('tenant-1', 'var-1');
  });

  it('returns the created variant to the caller', async () => {
    const result = await controller.create('tenant-1', 'prod-1', {
      attributes: { size: 'L' },
    });

    expect(result).toEqual(
      expect.objectContaining({ success: true, data: { id: 'v1' } }),
    );
  });

  it('returns the list under a data key, matching the other endpoints', async () => {
    service.findByProduct.mockResolvedValue([{ id: 'v1' }]);

    const result = await controller.list('tenant-1', 'prod-1');

    expect(result).toEqual(
      expect.objectContaining({ success: true, data: [{ id: 'v1' }] }),
    );
  });
});
