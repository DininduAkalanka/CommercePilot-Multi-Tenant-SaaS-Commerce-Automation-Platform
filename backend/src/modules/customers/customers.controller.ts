import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';

/**
 * CustomersController
 *
 * All routes require JWT authentication.
 * Tenant isolation is enforced via CurrentUser decorator.
 * Business logic lives in CustomersService, never here.
 */
@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /**
   * GET /api/v1/customers
   * Returns paginated customers for the authenticated tenant.
   * Supports optional search by name or phone number.
   */
  @Get()
  @ApiOperation({ summary: 'Get all customers with pagination and search' })
  @ApiResponse({ status: 200, description: 'List of customers' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by name or phone',
  })
  async findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(15), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    const data = await this.customersService.findAll(
      tenantId,
      page,
      limit,
      search,
    );
    return { success: true, data };
  }

  /**
   * GET /api/v1/customers/:id
   * Returns a specific customer's profile.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific customer by ID' })
  @ApiResponse({ status: 200, description: 'Customer details' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.customersService.findOne(tenantId, id);
    return { success: true, data };
  }

  /**
   * GET /api/v1/customers/:id/orders
   * Returns all orders placed by a specific customer.
   * Enforces tenant isolation.
   */
  @Get(':id/orders')
  @ApiOperation({ summary: 'Get all orders for a specific customer' })
  @ApiResponse({ status: 200, description: 'Customer order history' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findCustomerOrders(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.customersService.findCustomerOrders(tenantId, id);
    return { success: true, data };
  }

  /**
   * GET /api/v1/customers/:id/messages
   * Returns WhatsApp conversation history for a customer.
   * Used on the customer detail page to show full chat timeline.
   */
  @Get(':id/messages')
  @ApiOperation({ summary: 'Get WhatsApp message history for a customer' })
  @ApiResponse({ status: 200, description: 'Customer message history' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findCustomerMessages(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const data = await this.customersService.findCustomerMessages(
      tenantId,
      id,
      limit,
    );
    return { success: true, data };
  }
}
