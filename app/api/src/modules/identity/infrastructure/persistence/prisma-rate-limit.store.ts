import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type {
  ConsumeRateLimitInput,
  RateLimitBucket,
  RateLimitStore,
} from '../../application/ports/rate-limit-store.js';

@Injectable()
export class PrismaRateLimitStore implements RateLimitStore {
  private checks = 0;

  constructor(private readonly prisma: PrismaService) {}

  async consume(input: ConsumeRateLimitInput): Promise<RateLimitBucket> {
    const now = BigInt(input.now);
    const resetAt = now + BigInt(input.windowMs);
    const [bucket] = await this.prisma.$queryRaw<
      Array<{ count: number; resetAt: bigint }>
    >`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${input.key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "resetAt" <= ${now} THEN 1 ELSE MIN("count" + 1, ${input.limit + 1}) END,
        "resetAt" = CASE WHEN "resetAt" <= ${now} THEN ${resetAt} ELSE "resetAt" END
      RETURNING "count", "resetAt"
    `;

    if (++this.checks % 64 === 0) {
      await this.prisma.rateLimitBucket.deleteMany({
        where: { resetAt: { lte: now } },
      });
    }

    return { count: Number(bucket.count), resetAt: Number(bucket.resetAt) };
  }
}
