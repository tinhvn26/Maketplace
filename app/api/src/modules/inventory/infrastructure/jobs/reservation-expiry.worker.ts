import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import inventoryConfig from '../../../../config/inventory.config.js';
import { INVENTORY_RESERVATIONS } from '../../contracts/inventory.api.js';
import type { InventoryReservations } from '../../contracts/inventory.api.js';

/** Periodically returns held stock whose unconfirmed reservation passed its TTL. */
@Injectable()
export class ReservationExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationExpiryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    @Inject(INVENTORY_RESERVATIONS)
    private readonly reservations: InventoryReservations,
    @Inject(inventoryConfig.KEY)
    private readonly config: ConfigType<typeof inventoryConfig>,
  ) {}

  onModuleInit(): void {
    const tick = () => {
      void this.sweep().catch((error: unknown) =>
        this.logFailure('Reservation expiry sweep failed', error),
      );
    };
    // Release stock held while the process was down without waiting a full interval.
    tick();
    this.timer = setInterval(tick, this.config.expirySweepMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    try {
      await this.running;
    } catch (error) {
      this.logFailure('Reservation expiry sweep failed during shutdown', error);
    }
  }

  /** Never runs two sweeps at once; a call during a sweep joins it. */
  sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.expireAll().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async expireAll(): Promise<void> {
    // Skipped (conflicting) ids make a batch look partial, so stop only when a batch expires nothing.
    while (!this.stopping) {
      if ((await this.reservations.expireDue()) === 0) return;
    }
  }

  // Error messages (Prisma ones especially) can carry query arguments, so log only name and code.
  private logFailure(message: string, error: unknown): void {
    if (!(error instanceof Error)) {
      this.logger.error(`${message}: non-Error thrown`);
      return;
    }
    const { code } = error as { code?: unknown };
    const suffix = typeof code === 'string' ? ` (${code})` : '';
    this.logger.error(`${message}: ${error.name}${suffix}`);
  }
}
