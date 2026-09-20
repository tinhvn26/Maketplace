import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { LoginRequest } from './dto/login.request.js';
import { RegisterRequest } from './dto/register.request.js';
import { AuthService } from './auth.service.js';

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