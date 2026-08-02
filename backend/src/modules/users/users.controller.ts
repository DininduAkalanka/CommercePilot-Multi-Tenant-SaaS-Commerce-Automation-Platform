import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * UsersController
 *
 * Tenant team management. All routes require an authenticated OWNER
 * (SUPER_ADMIN bypasses via RolesGuard). Tenant isolation comes from
 * scoping every operation to the caller's tenantId.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List team members (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const { data, meta } = await this.usersService.findAll(
      tenantId,
      page,
      limit,
    );
    return { success: true, data, meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single team member' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.usersService.findOne(tenantId, id);
    return { success: true, data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a team member' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') actorUserId: string,
    @Body() dto: CreateUserDto,
  ) {
    const data = await this.usersService.create(tenantId, actorUserId, dto);
    return { success: true, message: 'User created successfully.', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a team member (name, role, active status)' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({
    status: 400,
    description: 'Business-rule violation (e.g. last owner)',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') actorUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const data = await this.usersService.update(tenantId, actorUserId, id, dto);
    return { success: true, message: 'User updated successfully.', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a team member' })
  @ApiResponse({ status: 200, description: 'User removed' })
  @ApiResponse({
    status: 400,
    description: 'Business-rule violation (e.g. last owner)',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') actorUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.usersService.remove(tenantId, actorUserId, id);
    return { success: true, message: 'User removed successfully.', data };
  }
}
