import { describe, expect, it } from 'vitest';
import { PlainTextAccountActionMessageBuilder } from './account-action-message.builder.js';

describe('PlainTextAccountActionMessageBuilder', () => {
  it('preserves leading zeros in an OTP and renders the reset instructions without a frontend link', () => {
    const builder = new PlainTextAccountActionMessageBuilder(
      'https://marketplate.example/',
    );

    const message = builder.build({
      purpose: 'RESET_PASSWORD',
      token: '012345',
      expiresInMinutes: 15,
    });

    expect(message).toEqual({
      subject: 'Reset your Marketplate password',
      text: 'Reset your password:\nOTP: 012345\nEnter this 6-digit code in Marketplate to set a new password.\n\nThis request expires in 15 minutes. If you did not request this, ignore this email.',
    });
  });

  it.each([
    {
      purpose: 'VERIFY_EMAIL' as const,
      path: 'verify-email',
      subject: 'Verify your Marketplate email',
      expiresInMinutes: 1440,
      lifetime: '24 hours',
    },
    {
      purpose: 'CHANGE_EMAIL' as const,
      path: 'change-email',
      subject: 'Confirm your new Marketplate email',
      expiresInMinutes: 15,
      lifetime: '15 minutes',
    },
  ])('renders the $purpose link at the configured frontend path', (input) => {
    const builder = new PlainTextAccountActionMessageBuilder(
      'https://marketplate.example/app///',
    );
    const message = builder.build({
      purpose: input.purpose,
      token: 'token+/=?',
      expiresInMinutes: input.expiresInMinutes,
    });

    expect(message.subject).toBe(input.subject);
    expect(message.text).toContain(
      `https://marketplate.example/app/${input.path}?token=token%2B%2F%3D%3F`,
    );
    expect(message.text).toContain(`expires in ${input.lifetime}.`);
    expect(message.text).not.toContain('Confirmation token:');
  });

  it.each(['VERIFY_EMAIL', 'CHANGE_EMAIL'] as const)(
    'renders a direct confirmation token for %s when no frontend URL is configured',
    (purpose) => {
      const builder = new PlainTextAccountActionMessageBuilder();
      const token = 'confirmation-token';
      const message = builder.build({ purpose, token, expiresInMinutes: 15 });

      expect(message.text).toContain(`Confirmation token: ${token}`);
      expect(message.text).not.toContain('?token=');
    },
  );
});
