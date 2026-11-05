import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type {
  TokenIssuer,
  TokenSubject,
} from '../../../application/ports/token-issuer.js';
import type { SessionRepository } from '../../../application/ports/session.repository.js';
import { AccessTokenGuard } from './access-token.guard.js';

function setup(authorization?: string | string[]) {
  const verifyAccessToken =
    vi.fn<(token: string) => Promise<TokenSubject | null>>();
  const findActive = vi.fn<SessionRepository['findActive']>();
  const sessions: SessionRepository = {
    findActive,
    createIfActive: vi.fn(),
    rotateRefreshToken: vi.fn(),
    revoke: vi.fn(),
    revokeAll: vi.fn(),
    listActive: vi.fn(),
  };
  const issuer: TokenIssuer = {
    issue: vi.fn(),
    verifyRefreshToken: vi.fn(),
    verifyAccessToken,
  };
  const request: {
    headers: { authorization?: string | string[] };
    userId?: string;
    sessionId?: string;
    role?: string;
  } = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return {
    guard: new AccessTokenGuard(issuer, sessions),
    context,
    request,
    verifyAccessToken,
    findActive,
  };
}

describe('AccessTokenGuard', () => {
  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic access-token',
    'Bearer access-token extra',
    ['Bearer first', 'Bearer second'],
  ])('rejects malformed Authorization header %j', async (header) => {
    const { guard, context, request, verifyAccessToken } = setup(header);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(request.userId).toBeUndefined();
  });

  it('rejects a token that cannot be verified', async () => {
    const { guard, context, request, verifyAccessToken } =
      setup('Bearer bad-token');
    verifyAccessToken.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifyAccessToken).toHaveBeenCalledWith('bad-token');
    expect(request.userId).toBeUndefined();
  });

  it('sets the authenticated subject from a verified token', async () => {
    const { guard, context, request, verifyAccessToken, findActive } =
      setup('bearer valid-token');
    verifyAccessToken.mockResolvedValue({
      userId: 'authenticated-user',
      sessionId: 'current-session',
    });
    findActive.mockResolvedValue({
      role: 'ADMIN',
      session: {
        id: 'current-session',
        userId: 'authenticated-user',
        authVersion: 0,
        refreshTokenHash: 'hash',
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        revokedAt: null,
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('authenticated-user');
    expect(request.sessionId).toBe('current-session');
    expect(request.role).toBe('ADMIN');
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-token');
    expect(findActive).toHaveBeenCalledWith(
      'current-session',
      'authenticated-user',
      expect.any(Date),
    );
  });

  it('rejects valid JWTs when the live session or account is invalid', async () => {
    const { guard, context, request, verifyAccessToken, findActive } =
      setup('Bearer valid-token');
    verifyAccessToken.mockResolvedValue({
      userId: 'user',
      sessionId: 'revoked-session',
    });
    findActive.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.userId).toBeUndefined();
  });
});
