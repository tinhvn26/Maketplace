import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JsonWebTokenError, JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import authConfig from '../../../../config/auth.config.js';
import type {
  TokenIssuer,
  TokenSubject,
} from '../../application/ports/token-issuer.js';
import type { AuthTokens } from '../../application/auth/auth-tokens.js';

@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(
    @Inject(JwtService)
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async issue(
    userId: string,
    sessionId: string,
    refreshExpiresAt: Date,
  ): Promise<AuthTokens> {
    const now = Math.floor(Date.now() / 1000);
    const refreshExpiry = Math.floor(refreshExpiresAt.getTime() / 1000);
    const accessExpiry = Math.min(
      now + this.config.accessTokenExpiresIn,
      refreshExpiry,
    );
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, sid: sessionId, tokenType: 'access', exp: accessExpiry },
        {
          secret: this.config.accessTokenSecret,
          algorithm: 'HS256',
          jwtid: randomUUID(),
        },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          sid: sessionId,
          tokenType: 'refresh',
          exp: refreshExpiry,
        },
        {
          secret: this.config.refreshTokenSecret,
          algorithm: 'HS256',
          jwtid: randomUUID(),
        },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, accessExpiry - now),
    };
  }

  verifyAccessToken(token: string): Promise<TokenSubject | null> {
    return this.verifyToken(token, 'access', this.config.accessTokenSecret);
  }

  verifyRefreshToken(token: string): Promise<TokenSubject | null> {
    return this.verifyToken(token, 'refresh', this.config.refreshTokenSecret);
  }

  private async verifyToken(
    token: string,
    tokenType: 'access' | 'refresh',
    secret: string,
  ): Promise<TokenSubject | null> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: unknown;
        sid?: unknown;
        jti?: unknown;
        tokenType?: unknown;
        exp?: unknown;
      }>(token, { secret, algorithms: ['HS256'] });
      if (
        typeof payload !== 'object' ||
        payload === null ||
        payload.tokenType !== tokenType ||
        !this.isNonEmptyString(payload.sub) ||
        !this.isNonEmptyString(payload.sid) ||
        !this.isNonEmptyString(payload.jti) ||
        typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.exp)
      )
        return null;
      return { userId: payload.sub, sessionId: payload.sid };
    } catch (error) {
      if (error instanceof JsonWebTokenError) return null;
      throw error;
    }
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
