import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  InMemoryMailTransport,
  Mailer,
  SmtpTransport,
  type MailModuleOptions,
} from '@nestjs/mail';
import identityMailConfig from '../../../../config/identity-mail.config.js';
import type {
  IdentityMailer,
  MailMessage,
} from '../../application/ports/identity-mailer.js';

/** Options for MailModule. The persisted outbox worker owns retries, so the Mailer tries once. */
export function identityMailOptions(
  config: ConfigType<typeof identityMailConfig>,
): MailModuleOptions {
  return {
    // Outbox mode never sends (see send()), but MailModule always needs a transport.
    transport:
      config.mode === 'smtp'
        ? new SmtpTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            startTls: config.requireTLS ? 'required' : 'opportunistic',
            auth: config.user
              ? { user: config.user, pass: config.password! }
              : undefined,
            timeouts: { connect: '10s', greeting: '10s', command: '20s', data: '20s' },
          })
        : new InMemoryMailTransport(),
    from: config.from,
    retry: false,
  };
}

@Injectable()
export class SmtpIdentityMailer implements IdentityMailer {
  constructor(
    private readonly mailer: Mailer,
    @Inject(identityMailConfig.KEY)
    private readonly config: ConfigType<typeof identityMailConfig>,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.mode !== 'smtp') {
      throw new Error('SMTP delivery is not configured');
    }
    await this.mailer.send(message);
  }
}
