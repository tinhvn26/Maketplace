import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../../../application/auth/auth.service.js';
import type { AuthTokens } from '../../../application/auth/auth-tokens.js';
import { LoginRequest } from '../dto/auth/login.request.js';
import { RegisterRequest } from '../dto/auth/register.request.js';
import { AuthTokenResponse } from '../dto/auth/auth-token.response.js';
import {
  toUserProfileResponse,
  type UserProfileResponse,
} from '../dto/users/user-profile.response.js';
import { RefreshRequest } from '../dto/auth/refresh.request.js';
import { AuthExceptionFilter } from '../filters/auth-exception.filter.js';
import { AccessTokenGuard } from '../guards/access-token.guard.js';
import { CurrentUserId } from '../decorators/current-user-id.decorator.js';
import { CurrentSessionId } from '../decorators/current-session-id.decorator.js';
import { AuthSessionResponse } from '../dto/auth/auth-session.response.js';
import { IdentityRateLimit } from '../decorators/identity-rate-limit.decorator.js';

@Controller('auth')
@IdentityRateLimit({ scope: 'identity.auth', limit: 120, windowMs: 60_000 })
@UseFilters(AuthExceptionFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @IdentityRateLimit({ scope: 'login', limit: 10 })
  @HttpCode(200)
  async login(@Body() dto: LoginRequest): Promise<AuthTokenResponse> {
    const result = await this.authService.login({
      email: dto.email,
      password: dto.password,
    });

    return this.toAuthTokenResponse(result);
  }

  @Post('register')
  @IdentityRateLimit({ scope: 'register', limit: 5 })
  @HttpCode(201)
  async register(
    @Body() request: RegisterRequest,
  ): Promise<UserProfileResponse> {
    const result = await this.authService.register({
      fullName: request.fullName,
      email: request.email,
      password: request.password,
      avatarUrl: request.avatarUrl,
    });

    return toUserProfileResponse(result);
  }

  @Post('refresh')
  @IdentityRateLimit({ scope: 'refresh', limit: 30 })
  @HttpCode(200)
  async refresh(@Body() dto: RefreshRequest): Promise<AuthTokenResponse> {
    const result = await this.authService.refresh(dto.refreshToken);

    return this.toAuthTokenResponse(result);
  }

  @Post('logout')
  @IdentityRateLimit({ scope: 'logout' })
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async logout(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string,
  ): Promise<void> {
    await this.authService.logout(userId, sessionId);
  }

  @Post('logout-all')
  @IdentityRateLimit({ scope: 'logout-all' })
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async logoutAll(@CurrentUserId() userId: string): Promise<void> {
    await this.authService.logoutAll(userId);
  }

  @Get('sessions')
  @IdentityRateLimit({ scope: 'sessions' })
  @UseGuards(AccessTokenGuard)
  async sessions(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string,
  ): Promise<AuthSessionResponse[]> {
    return this.authService.listSessions(userId, sessionId);
  }

  @Delete('sessions/:sessionId')
  @IdentityRateLimit({ scope: 'revoke-session' })
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async revokeSession(
    @CurrentUserId() userId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<void> {
    await this.authService.logout(userId, sessionId);
  }

  private toAuthTokenResponse(result: AuthTokens): AuthTokenResponse {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    };
  }
}
