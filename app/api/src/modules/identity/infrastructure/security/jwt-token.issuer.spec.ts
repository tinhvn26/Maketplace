import 'reflect-metadata';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { JwtTokenIssuer } from './jwt-token.issuer.js';

const config = {
  accessTokenSecret: 'access-token-test-secret-at-least-32-bytes',
  refreshTokenSecret: 'refresh-token-test-secret-at-least-32-bytes',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 604800,
};

describe('JwtTokenIssuer', () => {
  const jwt = new JwtService();
  const issuer = new JwtTokenIssuer(jwt, config);

  it('accepts issued access and refresh tokens only for their own purpose', async () => {
    const tokens = await issuer.issue(
      'user-123',
      'session-123',
      new Date(Date.now() + 604800000),
    );

    await expect(issuer.verifyAccessToken(tokens.accessToken)).resolves.toEqual(
      { userId: 'user-123', sessionId: 'session-123' },
    );
    await expect(
      issuer.verifyRefreshToken(tokens.refreshToken),
    ).resolves.toEqual({ userId: 'user-123', sessionId: 'session-123' });
    await expect(
      issuer.verifyAccessToken(tokens.refreshToken),
    ).resolves.toBeNull();
    await expect(
      issuer.verifyRefreshToken(tokens.accessToken),
    ).resolves.toBeNull();
  });

  it('issues distinct tokens while preserving absolute refresh expiry', async () => {
    const deadline = new Date(Date.now() + 604800000);
    const first = await issuer.issue('user-123', 'session-123', deadline);
    const second = await issuer.issue('user-123', 'session-123', deadline);
    expect(first.accessToken).not.toBe(second.accessToken);
    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(first.expiresIn).toBe(900);
    expect(jwt.decode<{ exp: number }>(first.refreshToken).exp).toBe(
      Math.floor(deadline.getTime() / 1000),
    );
    expect(jwt.decode<{ exp: number }>(second.refreshToken).exp).toBe(
      Math.floor(deadline.getTime() / 1000),
    );
  });

  it('bounds access token expiry by the session lifetime', async () => {
    const deadline = new Date(Date.now() + 60000);
    const tokens = await issuer.issue('user-123', 'session-123', deadline);
    expect(tokens.expiresIn).toBeLessThanOrEqual(60);
    expect(jwt.decode<{ exp: number }>(tokens.accessToken).exp).toBe(
      Math.floor(deadline.getTime() / 1000),
    );
  });

  it.each([
    { sid: undefined, jti: 'token-id' },
    { sid: '', jti: 'token-id' },
    { sid: 123, jti: 'token-id' },
    { sid: 'session-id', jti: undefined },
    { sid: 'session-id', jti: '   ' },
    { sid: 'session-id', jti: 123 },
  ])(
    'rejects signed tokens with malformed session identity %j',
    async (claims) => {
      const token = await jwt.signAsync(
        { sub: 'user-123', tokenType: 'access', ...claims },
        { secret: config.accessTokenSecret, expiresIn: 900 },
      );
      await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
    },
  );

  it.each([
    { label: 'missing subject', sub: undefined, tokenType: 'access' },
    { label: 'non-string subject', sub: 123, tokenType: 'access' },
    { label: 'empty subject', sub: '', tokenType: 'access' },
    { label: 'blank subject', sub: '   ', tokenType: 'access' },
    { label: 'missing purpose', sub: 'user-123', tokenType: undefined },
    { label: 'refresh purpose', sub: 'user-123', tokenType: 'refresh' },
  ])(
    'rejects a signed access token with $label',
    async ({ sub, tokenType }) => {
      const token = await jwt.signAsync(
        { sub, tokenType },
        { secret: config.accessTokenSecret, expiresIn: 900 },
      );

      await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
    },
  );

  it('rejects a token without expiry', async () => {
    const token = await jwt.signAsync(
      { sub: 'user-123', tokenType: 'access' },
      { secret: config.accessTokenSecret },
    );

    await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await jwt.signAsync(
      { sub: 'user-123', tokenType: 'access' },
      { secret: config.accessTokenSecret, expiresIn: -1 },
    );

    await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token before its validity period', async () => {
    const token = await jwt.signAsync(
      { sub: 'user-123', tokenType: 'access' },
      { secret: config.accessTokenSecret, expiresIn: 900, notBefore: 60 },
    );

    await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token signed with an unapproved algorithm', async () => {
    const token = await jwt.signAsync(
      { sub: 'user-123', tokenType: 'access' },
      {
        secret: config.accessTokenSecret,
        algorithm: 'HS384',
        expiresIn: 900,
      },
    );

    await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an access token signed with the refresh secret', async () => {
    const token = await jwt.signAsync(
      { sub: 'user-123', tokenType: 'access' },
      { secret: config.refreshTokenSecret, expiresIn: 900 },
    );

    await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
  });

  it.each(['', 'not-a-jwt', 'one.two.three'])(
    'rejects malformed token %j',
    async (token) => {
      await expect(issuer.verifyAccessToken(token)).resolves.toBeNull();
    },
  );

  it('propagates unexpected verification failures', async () => {
    const failingJwt = new JwtService();
    const error = new Error('unexpected failure');
    vi.spyOn(failingJwt, 'verifyAsync').mockRejectedValueOnce(error);
    const failingIssuer = new JwtTokenIssuer(failingJwt, config);

    await expect(failingIssuer.verifyAccessToken('token')).rejects.toBe(error);
  });
});
