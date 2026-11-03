export const IDENTITY_MAILER = Symbol('IDENTITY_MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface IdentityMailer {
  send(message: MailMessage): Promise<void>;
}
