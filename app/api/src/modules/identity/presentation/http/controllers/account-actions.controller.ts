import { Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import { AccountActionsService } from '../../../application/recovery/account-actions.service.js';
import {
  AccountActionTokenRequest,
  AccountEmailRequest,
  ResetPasswordRequest,
} from '../dto/recovery/account-action.request.js';
import { AccountActionsExceptionFilter } from '../filters/account-actions-exception.filter.js';
import { IdentityRateLimit } from '../decorators/identity-rate-limit.decorator.js';

const ACCEPTED_MESSAGE =
  'If the account is eligible, an email will be sent with further instructions';

@Controller()
@IdentityRateLimit({
  scope: 'identity.account-actions',
  limit: 5,
  windowMs: 15 * 60_000,
})
@UseFilters(AccountActionsExceptionFilter)
export class AccountActionsController {
  constructor(private readonly actions: AccountActionsService) {}

  @Post('auth/forgot-password')
  @IdentityRateLimit({ scope: 'forgot-password' })
  @HttpCode(202)
  async forgotPassword(
    @Body() body: AccountEmailRequest,
  ): Promise<{ message: string }> {
    await this.actions.requestPasswordReset(body.email);
    return { message: ACCEPTED_MESSAGE };
  }

  @Post('auth/reset-password')
  @IdentityRateLimit({ scope: 'reset-password' })
  @HttpCode(204)
  async resetPassword(@Body() body: ResetPasswordRequest): Promise<void> {
    await this.actions.resetPassword(body.email, body.otp, body.newPassword);
  }

  @Post('auth/verification/request')
  @IdentityRateLimit({ scope: 'request-verification' })
  @HttpCode(202)
  async requestVerification(
    @Body() body: AccountEmailRequest,
  ): Promise<{ message: string }> {
    await this.actions.requestVerification(body.email);
    return { message: ACCEPTED_MESSAGE };
  }

  @Post('auth/verification/confirm')
  @IdentityRateLimit({ scope: 'verify-email' })
  @HttpCode(204)
  async verifyEmail(@Body() body: AccountActionTokenRequest): Promise<void> {
    await this.actions.verifyEmail(body.token);
  }

  @Post('auth/email-change/confirm')
  @IdentityRateLimit({ scope: 'confirm-email-change' })
  @HttpCode(204)
  async confirmEmailChange(
    @Body() body: AccountActionTokenRequest,
  ): Promise<void> {
    await this.actions.confirmEmailChange(body.token);
  }
}
