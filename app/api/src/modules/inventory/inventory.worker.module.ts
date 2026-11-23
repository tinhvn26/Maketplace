import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import inventoryConfig from '../../config/inventory.config.js';
import { InventoryModule } from './inventory.module.js';
import { ReservationExpiryWorker } from './infrastructure/jobs/reservation-expiry.worker.js';

@Module({
  imports: [InventoryModule, ConfigModule.forFeature(inventoryConfig)],
  providers: [ReservationExpiryWorker],
})
export class InventoryWorkerModule {}
