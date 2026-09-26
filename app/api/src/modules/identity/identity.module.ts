import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import authConfig from '../../config/auth.config.js';

import { PASSWORD_HASHER } from './application/ports/password-hasher.js';
import type { PasswordHasher } from './application/ports/password-hasher.js';
import { USER_REPOSITORY } from './application/ports/user.repository.js';
import type { UserRepository } from './application/ports/user.repository.js';
import { TOKEN_ISSUER } from './application/ports/token-issuer.js';
import type { TokenIssuer } from './application/ports/token-issuer.js';
import { AuthService } from './application/auth/auth.service.js';
import { UsersService } from './application/users/users.service.js';

import { InMemoryUserRepository } from './infrastructure/persistence/in-memory-user.repository.js';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password.hasher.js';
import { JwtTokenIssuer } from './infrastructure/security/jwt-token.issuer.js';

import { AuthController } from './presentation/http/auth.controller.js';
import { AuthExceptionFilter } from './presentation/http/filters/auth-exception.filter.js';

@Module({
  imports: [ConfigModule.forFeature(authConfig), JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [USER_REPOSITORY, PASSWORD_HASHER, TOKEN_ISSUER],
      useFactory: (
        users: UserRepository,
        passwords: PasswordHasher,
        tokens: TokenIssuer,
      ) => new AuthService(users, passwords, tokens),
    },
    {
      provide: UsersService,
      inject: [USER_REPOSITORY],
      useFactory: (users: UserRepository) => new UsersService(users),
    },
    AuthExceptionFilter,
    { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: TOKEN_ISSUER, useClass: JwtTokenIssuer },
  ],
  exports: [AuthService],
})
export class IdentityModule {}
