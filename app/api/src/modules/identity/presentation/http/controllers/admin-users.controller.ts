import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from '../../../application/users/admin-users.service.js';
import { CurrentUserId } from '../decorators/current-user-id.decorator.js';
import {
  ListUsersRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
} from '../dto/users/admin-users.request.js';
import {
  toUserProfileResponse,
  type UserProfileResponse,
} from '../dto/users/user-profile.response.js';
import { UsersExceptionFilter } from '../filters/users-exception.filter.js';
import { AccessTokenGuard } from '../guards/access-token.guard.js';
import { AdminRoleGuard } from '../guards/admin-role.guard.js';
import { IdentityRateLimit } from '../decorators/identity-rate-limit.decorator.js';

@Controller('admin/users')
@IdentityRateLimit({
  scope: 'identity.admin-users',
  limit: 120,
  windowMs: 60_000,
})
@UseGuards(AccessTokenGuard, AdminRoleGuard)
@UseFilters(UsersExceptionFilter)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @IdentityRateLimit({ scope: 'list' })
  async list(@Query() query: ListUsersRequest) {
    const result = await this.usersService.list(query);
    return {
      ...result,
      users: result.users.map(toUserProfileResponse),
    };
  }

  @Get(':id')
  @IdentityRateLimit({ scope: 'get' })
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
  ): Promise<UserProfileResponse> {
    return toUserProfileResponse(await this.usersService.get(userId));
  }

  @Patch(':id/status')
  @IdentityRateLimit({ scope: 'update-status' })
  async updateStatus(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() request: UpdateUserStatusRequest,
  ): Promise<UserProfileResponse> {
    return toUserProfileResponse(
      await this.usersService.updateStatus(actorId, userId, request.status),
    );
  }

  @Patch(':id/role')
  @IdentityRateLimit({ scope: 'update-role' })
  async updateRole(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() request: UpdateUserRoleRequest,
  ): Promise<UserProfileResponse> {
    return toUserProfileResponse(
      await this.usersService.updateRole(actorId, userId, request.role),
    );
  }

  @Delete(':id')
  @IdentityRateLimit({ scope: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUserId() actorId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
  ): Promise<void> {
    await this.usersService.delete(actorId, userId);
  }
}
