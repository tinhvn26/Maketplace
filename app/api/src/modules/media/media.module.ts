import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SHOP_ACCESS } from '../shops/contracts/shops.api.js';
import type { ShopAccess } from '../shops/contracts/shops.api.js';
import { ShopsModule } from '../shops/shops.module.js';
import { MediaService } from './application/media.service.js';
import { MEDIA_ASSETS } from './contracts/media.api.js';
import { LocalMediaStorage } from './infrastructure/local-media.storage.js';
import { PrismaMediaRepository } from './infrastructure/prisma-media.repository.js';
import { SharpImageProcessor } from './infrastructure/sharp-image.processor.js';
import { MediaAuthenticatedGuard } from './presentation/media-authenticated.guard.js';
import { MediaExceptionFilter } from './presentation/media-exception.filter.js';
import {
  MediaController,
  MediaPublicController,
} from './presentation/media.controller.js';

function mediaBaseUrl(): string {
  const url = new URL(
    process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:3000',
  );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  )
    throw new Error(
      'MEDIA_PUBLIC_BASE_URL must be an HTTP(S) base URL without credentials, query or fragment; production requires HTTPS',
    );
  return url.href.replace(/\/+$/, '');
}

@Module({
  imports: [DatabaseModule, IdentityModule, ShopsModule],
  controllers: [MediaController, MediaPublicController],
  providers: [
    PrismaMediaRepository,
    {
      provide: MediaService,
      inject: [PrismaMediaRepository, SHOP_ACCESS],
      useFactory: (assets: PrismaMediaRepository, shops: ShopAccess) =>
        new MediaService(
          assets,
          new LocalMediaStorage(
            process.env.MEDIA_STORAGE_PATH ??
              resolve(process.cwd(), 'var', 'media'),
          ),
          new SharpImageProcessor(),
          shops,
          { nextId: randomUUID, now: () => new Date() },
          mediaBaseUrl(),
        ),
    },
    { provide: MEDIA_ASSETS, useExisting: MediaService },
    MediaAuthenticatedGuard,
    MediaExceptionFilter,
  ],
  exports: [MEDIA_ASSETS, MediaService],
})
export class MediaModule {}
