import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import authConfig from '../../../../config/auth.config.js';
import type { TokenIssuer } from '../../application/ports/token-issuer.js';
import type { AuthTokens } from '../../application/models/auth-tokens.js';
import { JsonWebTokenError, JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async issue(userId: string): Promise<AuthTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, tokenType: 'access' },
        {
          secret: this.config.accessTokenSecret,
          algorithm: 'HS256',
          expiresIn: this.config.accessTokenExpiresIn,
          jwtid: randomUUID(),
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, tokenType: 'refresh' },
        {
          secret: this.config.refreshTokenSecret,
          algorithm: 'HS256',
          expiresIn: this.config.refreshTokenExpiresIn,
          jwtid: randomUUID(),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenExpiresIn,
    };
  }

  async verifyRefreshToken(token: string): Promise<string | null> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: unknown;
        tokenType?: unknown;
        exp?: unknown;
      }>(token, {
        secret: this.config.refreshTokenSecret,
        algorithms: ['HS256'],
      });

      if (
        typeof payload !== 'object' ||
        payload === null ||
        payload.tokenType !== 'refresh' ||
        typeof payload.sub !== 'string' ||
        payload.sub.trim().length === 0 ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp)
      ) {
        return null;
      }

      return payload.sub;
    } catch (error) {
      // Bao gồm lỗi chữ ký, hết hạn và token chưa tới thời điểm sử dụng.
      if (error instanceof JsonWebTokenError) {
        return null;
      }

      throw error;
    }
  }

  async issueAccessToken(userId: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, tokenType: 'access' },
      {
        secret: this.config.accessTokenSecret,
        algorithm: 'HS256',
        expiresIn: this.config.accessTokenExpiresIn,
        jwtid: randomUUID(),
      },
    );

    return {
      accessToken,
      expiresIn: this.config.accessTokenExpiresIn,
    };
  }
}
