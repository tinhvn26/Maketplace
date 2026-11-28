import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { InventoryWorkerModule } from './modules/inventory/inventory.worker.module.js';

/** Background jobs without the HTTP server. Run API instances with
 * INVENTORY_EMBEDDED_WORKER=false so only this process sweeps reservations. */
@Module({ imports: [ConfigModule.forRoot(), InventoryWorkerModule] })
class WorkerModule {}

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
