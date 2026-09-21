import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from '../../application/auth/auth.service.js';
import { LoginRequest } from './dto/auth/login.request.js';
import { RegisterRequest } from './dto/auth/register.request.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginRequest) {
    return this.authService.login(dto);
  }

  @Post('register')
  @HttpCode(201)
  register(@Body() request: RegisterRequest) {
    return this.authService.register(request);
  }

  @Post('logout')
  @HttpCode(200)
  logout() {
    return this.authService.logout();
  }
}