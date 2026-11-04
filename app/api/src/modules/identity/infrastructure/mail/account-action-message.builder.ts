import type {
  AccountActionMessage,
  AccountActionMessageBuilder,
  AccountActionMessageInput,
} from '../../application/ports/account-action-message-builder.js';

export class PlainTextAccountActionMessageBuilder implements AccountActionMessageBuilder {
  constructor(private readonly publicAppUrl?: string) {}

  build({
    purpose,
    token,
    expiresInMinutes,
  }: AccountActionMessageInput): AccountActionMessage {
    const details = {
      VERIFY_EMAIL: {
        subject: 'Verify your Marketplate email',
        path: 'verify-email',
        instruction: 'Verify your email address',
      },
      RESET_PASSWORD: {
        subject: 'Reset your Marketplate password',
        path: 'reset-password',
        instruction: 'Reset your password',
      },
      CHANGE_EMAIL: {
        subject: 'Confirm your new Marketplate email',
        path: 'change-email',
        instruction: 'Confirm your new email address',
      },
    }[purpose];
    const destination =
      purpose === 'RESET_PASSWORD'
        ? `OTP: ${token}\nEnter this 6-digit code in Marketplate to set a new password.`
        : this.publicAppUrl
          ? `${this.publicAppUrl.replace(/\/+$/, '')}/${details.path}?token=${encodeURIComponent(token)}`
          : `Confirmation token: ${token}`;
    const lifetime =
      expiresInMinutes === 24 * 60 ? '24 hours' : `${expiresInMinutes} minutes`;

    return {
      subject: details.subject,
      text: `${details.instruction}:\n${destination}\n\nThis request expires in ${lifetime}. If you did not request this, ignore this email.`,
    };
  }
}
