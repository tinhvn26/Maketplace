import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import identityMailConfig from '../../../../config/identity-mail.config.js';
import type { IdentityMailer, MailMessage } from '../../application/ports/identity-mailer.js';

@Injectable()
export class SmtpIdentityMailer implements IdentityMailer {
  private transport?: Transporter;

  constructor(
    @Inject(identityMailConfig.KEY)
    private readonly config: ConfigType<typeof identityMailConfig>,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.mode !== 'smtp') {
      throw new Error('SMTP delivery is not configured');
    }
    this.transport ??= nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTLS: this.config.requireTLS,
      auth: this.config.user
        ? { user: this.config.user, pass: this.config.password }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    await this.transport.sendMail({ from: this.config.from, ...message });
  }
}
