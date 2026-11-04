export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export interface ConsumeRateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}

export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /** Atomically starts or increments a fixed window, capped at limit + 1. */
  consume(input: ConsumeRateLimitInput): Promise<RateLimitBucket>;
}
