import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import authConfig from '../../config/auth.config.js';
import identityMailConfig from '../../config/identity-mail.config.js';
import { DatabaseModule } from '../../platform/database/database.module.js';

import { PASSWORD_HASHER } from './application/ports/password-hasher.js';
import type { PasswordHasher } from './application/ports/password-hasher.js';
import { USER_REPOSITORY } from './application/ports/user.repository.js';
import type {
  AdminUserRepository,
  AuthUserRepository,
  UserProfileRepository,
  UserReader,
} from './application/ports/user.repository.js';
import { TOKEN_ISSUER } from './application/ports/token-issuer.js';
import type { TokenIssuer } from './application/ports/token-issuer.js';
import { SESSION_REPOSITORY } from './application/ports/session.repository.js';
import type { SessionRepository } from './application/ports/session.repository.js';
import { ACCOUNT_ACTION_REPOSITORY } from './application/ports/account-action.repository.js';
import type { AccountActionRepository } from './application/ports/account-action.repository.js';
import { IDENTITY_MAILER } from './application/ports/identity-mailer.js';
import { IDENTITY_LOGGER } from './application/ports/identity-logger.js';
import type { IdentityLogger } from './application/ports/identity-logger.js';
import type { EmailVerificationRequester } from './application/ports/email-verification-requester.js';
import { ACCOUNT_ACTION_MESSAGE_BUILDER } from './application/ports/account-action-message-builder.js';
import type { AccountActionMessageBuilder } from './application/ports/account-action-message-builder.js';
import { RATE_LIMIT_STORE } from './application/ports/rate-limit-store.js';

import { AuthService } from './application/auth/auth.service.js';
import { UsersService } from './application/users/users.service.js';
import { AdminUsersService } from './application/users/admin-users.service.js';
import { AccountActionsService } from './application/recovery/account-actions.service.js';

import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository.js';
import { PrismaSessionRepository } from './infrastructure/persistence/prisma-session.repository.js';
import { PrismaAccountActionRepository } from './infrastructure/persistence/prisma-account-action.repository.js';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password.hasher.js';
import { JwtTokenIssuer } from './infrastructure/security/jwt-token.issuer.js';
import { SmtpIdentityMailer } from './infrastructure/mail/smtp-identity.mailer.js';
import { IdentityMailWorker } from './infrastructure/mail/identity-mail.worker.js';
import { PlainTextAccountActionMessageBuilder } from './infrastructure/mail/account-action-message.builder.js';
import { PrismaRateLimitStore } from './infrastructure/persistence/prisma-rate-limit.store.js';

import { AuthController } from './presentation/http/controllers/auth.controller.js';
import { UsersController } from './presentation/http/controllers/users.controller.js';
import { AdminUsersController } from './presentation/http/controllers/admin-users.controller.js';
import { AccountActionsController } from './presentation/http/controllers/account-actions.controller.js';
import { AuthExceptionFilter } from './presentation/http/filters/auth-exception.filter.js';
import { UsersExceptionFilter } from './presentation/http/filters/users-exception.filter.js';
import { AccountActionsExceptionFilter } from './presentation/http/filters/account-actions-exception.filter.js';
import { AccessTokenGuard } from './presentation/http/guards/access-token.guard.js';
import { AdminRoleGuard } from './presentation/http/guards/admin-role.guard.js';
import { IdentityRateLimitGuard } from './presentation/http/guards/identity-rate-limit.guard.js';

@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    ConfigModule.forFeature(identityMailConfig),
    JwtModule.register({}),
    DatabaseModule,
  ],
  controllers: [
    AuthController,
    UsersController,
    AdminUsersController,
    AccountActionsController,
  ],
  providers: [
    // ── Application Services (framework-agnostic, wired via useFactory) ──────
    {
      provide: AuthService,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        TOKEN_ISSUER,
        SESSION_REPOSITORY,
        AccountActionsService,
        IDENTITY_LOGGER,
      ],
      useFactory: (
        users: AuthUserRepository,
        passwords: PasswordHasher,
        tokens: TokenIssuer,
        sessions: SessionRepository,
        verification: EmailVerificationRequester,
        logger: IdentityLogger,
      ) =>
        new AuthService(
          users,
          passwords,
          tokens,
          sessions,
          verification,
          logger,
        ),
    },
    {
      provide: UsersService,
      inject: [USER_REPOSITORY, PASSWORD_HASHER],
      useFactory: (users: UserProfileRepository, passwords: PasswordHasher) =>
        new UsersService(users, passwords),
    },
    {
      provide: AdminUsersService,
      inject: [USER_REPOSITORY],
      useFactory: (users: AdminUserRepository) => new AdminUsersService(users),
    },
    {
      provide: AccountActionsService,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        ACCOUNT_ACTION_REPOSITORY,
        authConfig.KEY,
        ACCOUNT_ACTION_MESSAGE_BUILDER,
      ],
      useFactory: (
        users: UserReader,
        passwords: PasswordHasher,
        actions: AccountActionRepository,
        auth: ConfigType<typeof authConfig>,
        messages: AccountActionMessageBuilder,
      ) =>
        new AccountActionsService(
          users,
          passwords,
          actions,
          {
            resetOtpSecret: auth.refreshTokenSecret,
          },
          messages,
        ),
    },
    // ── Infrastructure — Ports → Adapters ────────────────────────────────────
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: RATE_LIMIT_STORE, useClass: PrismaRateLimitStore },
    {
      provide: IDENTITY_LOGGER,
      useFactory: () => new Logger(AuthService.name),
    },
    {
      provide: ACCOUNT_ACTION_MESSAGE_BUILDER,
      inject: [identityMailConfig.KEY],
      useFactory: (config: ConfigType<typeof identityMailConfig>) =>
        new PlainTextAccountActionMessageBuilder(config.publicAppUrl),
    },
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: TOKEN_ISSUER, useClass: JwtTokenIssuer },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    {
      provide: ACCOUNT_ACTION_REPOSITORY,
      useClass: PrismaAccountActionRepository,
    },
    { provide: IDENTITY_MAILER, useExisting: SmtpIdentityMailer },
    // ── Infrastructure — Workers & Mailer ────────────────────────────────────
    SmtpIdentityMailer,
    IdentityMailWorker,
    // ── Presentation — Exception Filters ─────────────────────────────────────
    AuthExceptionFilter,
    UsersExceptionFilter,
    AccountActionsExceptionFilter,
    // ── Presentation — Guards ────────────────────────────────────────────────
    AccessTokenGuard,
    AdminRoleGuard,
    IdentityRateLimitGuard,
    { provide: APP_GUARD, useExisting: IdentityRateLimitGuard },
  ],
  exports: [AuthService, AccessTokenGuard, AdminRoleGuard],
})
export class IdentityModule {}
