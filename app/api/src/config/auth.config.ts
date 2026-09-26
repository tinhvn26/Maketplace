import { registerAs } from '@nestjs/config';

function signingSecret(name: string): string {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value.trim(), 'utf8') < 32) {
    throw new Error(
      `${name} must contain at least 32 bytes of secret material`,
    );
  }
  return value;
}

export default registerAs('auth', () => {
  const accessTokenSecret = signingSecret('JWT_ACCESS_SECRET');
  const refreshTokenSecret = signingSecret('JWT_REFRESH_SECRET');
  if (accessTokenSecret === refreshTokenSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    );
  }

  return {
    accessTokenSecret,
    refreshTokenSecret,
    accessTokenExpiresIn: 15 * 60,
    refreshTokenExpiresIn: 7 * 24 * 60 * 60,
  };
});
