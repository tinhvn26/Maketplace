import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { RATE_LIMIT_STORE } from '../../../application/ports/rate-limit-store.js';
import type { RateLimitStore } from '../../../application/ports/rate-limit-store.js';
import {
  IDENTITY_RATE_LIMIT,
  type IdentityRateLimitOptions,
} from '../decorators/identity-rate-limit.decorator.js';

@Injectable()
export class IdentityRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const defaults = this.reflector.get<IdentityRateLimitOptions>(
      IDENTITY_RATE_LIMIT,
      context.getClass(),
    );
    const endpoint = this.reflector.get<IdentityRateLimitOptions>(
      IDENTITY_RATE_LIMIT,
      context.getHandler(),
    );
    if (!defaults && !endpoint) return true;

    const limit = endpoint?.limit ?? defaults?.limit ?? 120;
    const windowMs = endpoint?.windowMs ?? defaults?.windowMs ?? 60_000;
    const scope = [defaults?.scope, endpoint?.scope].filter(Boolean).join('.');
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const request = http.getRequest<Request>();
    const key = createHash('sha256')
      .update(
        `${scope}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
      )
      .digest('hex');
    const now = Date.now();
    const bucket = await this.store.consume({ key, limit, windowMs, now });
    if (bucket.count > limit) {
      http
        .getResponse<Response>()
        .setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        );
      throw new HttpException(
        'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
