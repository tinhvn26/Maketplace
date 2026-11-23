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

  constructor(
    @Inject(INVENTORY_RESERVATIONS)
    private readonly reservations: InventoryReservations,
    @Inject(inventoryConfig.KEY)
    private readonly config: ConfigType<typeof inventoryConfig>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch(() => {
        this.logger.error('Reservation expiry sweep failed');
      });
    }, this.config.expirySweepMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      await this.running;
    } catch {
      this.logger.error('Reservation expiry sweep failed during shutdown');
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
    // A full batch means more may be waiting: keep going until the backlog is drained.
    for (;;) {
      const expired = await this.reservations.expireDue(100);
      if (expired < 100) return;
    }
  }
}
