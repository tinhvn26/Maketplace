import { SetMetadata } from '@nestjs/common';

export const IDENTITY_RATE_LIMIT = Symbol('IDENTITY_RATE_LIMIT');

export interface IdentityRateLimitOptions {
  /** Stable scope: independent of the controller class or method name. */
  scope: string;
  limit?: number;
  windowMs?: number;
}

/** Controller defaults are inherited; endpoint options override them. */
export const IdentityRateLimit = (options: IdentityRateLimitOptions) =>
  SetMetadata(IDENTITY_RATE_LIMIT, options);
