import { registerAs } from '@nestjs/config';

export default registerAs('identityMail', () => {
  const production = process.env.NODE_ENV === 'production';
  const mode =
    process.env.IDENTITY_MAIL_TRANSPORT ?? (production ? 'smtp' : 'outbox');
  if (mode !== 'smtp' && mode !== 'outbox') {
    throw new Error('IDENTITY_MAIL_TRANSPORT must be smtp or outbox');
  }
  if (production && mode !== 'smtp') {
    throw new Error('Production identity email requires SMTP');
  }

  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const secure = process.env.SMTP_SECURE === 'true';
  const requireTLS = process.env.SMTP_REQUIRE_TLS !== 'false';
  const port = Number(process.env.SMTP_PORT ?? (secure ? '465' : '587'));

  for (const key of ['SMTP_SECURE', 'SMTP_REQUIRE_TLS']) {
    if (process.env[key] && !['true', 'false'].includes(process.env[key]!)) {
      throw new Error(`${key} must be true or false`);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }
  if (mode === 'smtp' && (!host || !from)) {
    throw new Error('SMTP_HOST and SMTP_FROM are required for SMTP');
  }
  if (Boolean(user) !== Boolean(password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  }
  if (production && !secure && !requireTLS) {
    throw new Error('Production SMTP requires TLS');
  }

  const publicAppUrl = process.env.IDENTITY_PUBLIC_APP_URL?.trim() || undefined;
  if (publicAppUrl) {
    const url = new URL(publicAppUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'IDENTITY_PUBLIC_APP_URL must be an HTTP(S) base URL without credentials, query or fragment',
      );
    }
    if (production && url.protocol !== 'https:') {
      throw new Error('Production IDENTITY_PUBLIC_APP_URL requires HTTPS');
    }
  }

  return {
    mode,
    host,
    port,
    from,
    user,
    password,
    secure,
    requireTLS,
    publicAppUrl,
  };
});
