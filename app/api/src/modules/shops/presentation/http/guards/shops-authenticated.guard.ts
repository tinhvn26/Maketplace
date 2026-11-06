import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../../../../identity/presentation/http/guards/access-token.guard.js';

@Injectable()
export class ShopsAuthenticatedGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenGuard) private readonly access: AccessTokenGuard,
  ) {}
  canActivate(context: ExecutionContext): Promise<boolean> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return this.access.canActivate(context);
  }
}
