import type { AuthTokens } from '../models/auth-tokens.js';

export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');

export interface TokenIssuer {
  issue(userId: string): Promise<AuthTokens>;

  verifyRefreshToken(token: string): Promise<string | null>;

  issueAccessToken(userId: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }>;
}
