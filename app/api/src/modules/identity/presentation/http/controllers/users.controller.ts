import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from '../../../application/users/users.service.js';
import { CurrentUserId } from '../decorators/current-user-id.decorator.js';
import { CurrentSessionId } from '../decorators/current-session-id.decorator.js';
import { UpdateProfileDto } from '../dto/users/update-profile.request.js';
import { ChangePasswordRequest } from '../dto/users/change-password.request.js';
import { DeleteAccountRequest } from '../dto/users/delete-account.request.js';
import {
  toUserProfileResponse,
  type UserProfileResponse,
} from '../dto/users/user-profile.response.js';
import { UsersExceptionFilter } from '../filters/users-exception.filter.js';
import { AccessTokenGuard } from '../guards/access-token.guard.js';
import { ChangeEmailRequest } from '../dto/recovery/account-action.request.js';
import { IdentityRateLimit } from '../decorators/identity-rate-limit.decorator.js';

@Controller('user')
@IdentityRateLimit({ scope: 'identity.users', limit: 120, windowMs: 60_000 })
@UseGuards(AccessTokenGuard)
@UseFilters(UsersExceptionFilter)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @IdentityRateLimit({ scope: 'get-profile' })
  async getProfile(
    @CurrentUserId() userId: string,
  ): Promise<UserProfileResponse> {
    return toUserProfileResponse(await this.usersService.getProfile(userId));
  }

  @Patch('me')
  @IdentityRateLimit({ scope: 'update-profile' })
  async updateProfile(
    @CurrentUserId() userId: string,
    @Body() request: UpdateProfileDto,
  ): Promise<UserProfileResponse> {
    const result = await this.usersService.updateProfile(userId, {
      fullName: request.fullName,
      avatarUrl: request.avatarUrl,
    });

    return toUserProfileResponse(result);
  }

  @Post('me/change-password')
  @IdentityRateLimit({ scope: 'change-password', limit: 10 })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUserId() userId: string,
    @Body() request: ChangePasswordRequest,
  ): Promise<void> {
    await this.usersService.changePassword(userId, {
      currentPassword: request.currentPassword,
      newPassword: request.newPassword,
    });
  }

  @Post('me/change-email')
  @IdentityRateLimit({ scope: 'change-email', limit: 5, windowMs: 15 * 60_000 })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeEmail(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string,
    @Body() request: ChangeEmailRequest,
  ): Promise<void> {
    await this.usersService.changeEmail(userId, {
      sessionId,
      currentPassword: request.currentPassword,
      newEmail: request.newEmail,
    });
  }

  @Delete('me')
  @IdentityRateLimit({ scope: 'delete-account', limit: 10 })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @CurrentUserId() userId: string,
    @Body() request: DeleteAccountRequest,
  ): Promise<void> {
    await this.usersService.deleteAccount(userId, request.currentPassword);
  }
}
