import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccessTokenGuard } from '../../../../identity/contracts/identity.http.js';

@Injectable()
export class CatalogSellerGuard implements CanActivate {
  constructor(private readonly access: AccessTokenGuard) {}
  canActivate(context: ExecutionContext) {
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'no-store');
    return this.access.canActivate(context);
  }
}
