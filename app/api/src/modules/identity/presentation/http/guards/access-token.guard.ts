import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { TOKEN_ISSUER } from '../../../application/ports/token-issuer.js';
import type { TokenIssuer } from '../../../application/ports/token-issuer.js';
import { SESSION_REPOSITORY } from '../../../application/ports/session.repository.js';
import type { SessionRepository } from '../../../application/ports/session.repository.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
  role?: 'USER' | 'ADMIN';
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_ISSUER)
    private readonly tokenIssuer: TokenIssuer,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepository: SessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer +(\S+)$/i.exec(authorization.trim())
        : null;

    if (!match) {
      throw new UnauthorizedException('A Bearer access token is required');
    }

    const subject = await this.tokenIssuer.verifyAccessToken(match[1]);

    if (!subject) {
      throw new UnauthorizedException('Access token is invalid or expired');
    }

    const active = await this.sessionRepository.findActive(
      subject.sessionId,
      subject.userId,
      new Date(),
    );
    if (!active) {
      throw new UnauthorizedException('Session is invalid or expired');
    }

    request.userId = subject.userId;
    request.sessionId = subject.sessionId;
    request.role = active.role;
    return true;
  }
}
