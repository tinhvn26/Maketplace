import type { AuthTokens } from '../auth/auth-tokens.js';

export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');

export interface TokenSubject {
  userId: string;
  sessionId: string;
}

export interface TokenIssuer {
  issue(
    userId: string,
    sessionId: string,
    refreshExpiresAt: Date,
  ): Promise<AuthTokens>;
  verifyAccessToken(token: string): Promise<TokenSubject | null>;
  verifyRefreshToken(token: string): Promise<TokenSubject | null>;
}
