import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../../../../identity/presentation/http/guards/access-token.guard.js';
import { AdminRoleGuard } from '../../../../identity/presentation/http/guards/admin-role.guard.js';

/** Reuses Identity's exported providers without exposing its internal ports. */
@Injectable()
export class CatalogAdminGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenGuard) private readonly accessToken: AccessTokenGuard,
    @Inject(AdminRoleGuard) private readonly adminRole: AdminRoleGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    if (!(await this.accessToken.canActivate(context))) return false;
    return this.adminRole.canActivate(context);
  }
}
