import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import type { MediaRepository } from '../../application/ports/media.ports.js';
import type { MediaActor } from '../../contracts/media.api.js';
import type { MediaAsset } from '../../domain/entities/media-asset.js';
import {
  MediaForbiddenError,
  MediaInUseError,
  MediaNotFoundError,
} from '../../domain/errors/media.errors.js';
import {
  findActiveAccount,
  lockAccount,
} from '../../../identity/contracts/identity.persistence.js';
import { findShopState } from '../../../shops/contracts/shops.persistence.js';
import {
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../../shops/contracts/shops.api.js';

@Injectable()
export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(asset: MediaAsset, actor: MediaActor): Promise<MediaAsset> {
    return this.prisma.$transaction(async (tx) => {
      await lockAccount(tx, actor.userId);
      await this.requireAccess(tx, asset.shopId, actor);
      if (asset.ownerId !== actor.userId) throw new MediaForbiddenError();
      return this.toAsset(await tx.mediaAsset.create({ data: asset }));
    });
  }

  async findById(id: string): Promise<MediaAsset | null> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    return asset ? this.toAsset(asset) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return [];
    return (
      await this.prisma.mediaAsset.findMany({ where: { id: { in: [...ids] } } })
    ).map((asset) => this.toAsset(asset));
  }

  async deleteUnused(id: string, actor: MediaActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockAccount(tx, actor.userId);
      const current = await tx.mediaAsset.findUnique({ where: { id } });
      if (!current || current.status !== 'READY')
        throw new MediaNotFoundError();
      await this.requireAccess(tx, current.shopId, actor);
      // The write lock serializes this status change with Catalog's usage binding.
      const deleted = await tx.mediaAsset.updateMany({
        where: { id, status: 'READY', usages: { none: {} } },
        data: { status: 'DELETED' },
      });
      if (deleted.count === 1) return;
      const asset = await tx.mediaAsset.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!asset || asset.status !== 'READY') throw new MediaNotFoundError();
      throw new MediaInUseError();
    });
  }

  private async requireAccess(
    tx: Prisma.TransactionClient,
    shopId: string | null,
    actor: MediaActor,
  ): Promise<void> {
    if (!(await findActiveAccount(tx, actor)))
      throw new MediaForbiddenError(
        'An active account with current privileges is required',
      );
    if (shopId === null) {
      if (actor.role !== 'ADMIN')
        throw new MediaForbiddenError(
          'Platform media requires administrator access',
        );
      return;
    }
    const shop = await findShopState(tx, shopId);
    if (!shop) throw new ShopNotFoundError();
    if (actor.role !== 'ADMIN' && shop.ownerId !== actor.userId)
      throw new MediaForbiddenError();
    if (!shop.sellable) throw new ShopUnavailableError();
  }

  private toAsset(
    asset: Omit<MediaAsset, 'status'> & { status: string },
  ): MediaAsset {
    if (asset.status !== 'READY' && asset.status !== 'DELETED')
      throw new Error('Unsupported persisted media status');
    return { ...asset, status: asset.status };
  }
}
