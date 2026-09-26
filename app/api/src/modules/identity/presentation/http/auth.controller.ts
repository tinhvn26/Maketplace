import { Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import { AuthService } from '../../application/auth/auth.service.js';
import type { AuthTokens } from '../../application/models/auth-tokens.js';
import { LoginRequest } from './dto/auth/login.request.js';
import { RegisterRequest } from './dto/auth/register.request.js';
import { AuthTokenResponse } from './dto/auth/auth-token.response.js';
import { UserProfileResponse } from './dto/users/user-profile.response.js';
import { RefreshRequest } from './dto/auth/refresh.request.js';
import { AuthExceptionFilter } from './filters/auth-exception.filter.js';

@Controller('auth')
@UseFilters(AuthExceptionFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginRequest): Promise<AuthTokenResponse> {
    const result = await this.authService.login({
      email: dto.email,
      password: dto.password,
    });

    return this.toAuthTokenResponse(result);
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() request: RegisterRequest,
  ): Promise<UserProfileResponse> {
    const result = await this.authService.register({
      fullName: request.fullName,
      email: request.email,
      password: request.password,
    });

    return {
      id: result.id,
      fullName: result.fullName,
      email: result.email,
      status: result.status,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshRequest): Promise<AuthTokenResponse> {
    const result = await this.authService.refresh(dto.refreshToken);

    return this.toAuthTokenResponse(result);
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
