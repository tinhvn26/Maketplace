import type {
  MediaActor,
  MediaAssets,
  ResolvedMediaAsset,
} from '../contracts/media.api.js';
import { MEDIA_MAX_BYTES } from '../domain/media-asset.js';
import type { MediaAsset } from '../domain/media-asset.js';
import {
  MediaForbiddenError,
  MediaNotFoundError,
  MediaValidationError,
} from '../domain/media.errors.js';
import type {
  MediaImageProcessor,
  MediaRepository,
  MediaRuntime,
  MediaShopAccess,
  MediaStorage,
} from './media.ports.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MediaService implements MediaAssets {
  constructor(
    private readonly assets: MediaRepository,
    private readonly storage: MediaStorage,
    private readonly images: MediaImageProcessor,
    private readonly shops: MediaShopAccess,
    private readonly runtime: MediaRuntime,
    private readonly publicBaseUrl: string,
  ) {}

  async upload(shopId: string | null, actor: MediaActor, bytes: Uint8Array) {
    await this.authorize(shopId, actor);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MEDIA_MAX_BYTES
    ) {
      throw new MediaValidationError(
        'Images must contain between 1 byte and 5 MB',
      );
    }
    const image = await this.images.process(bytes);
    if (image.original.byteLength > MEDIA_MAX_BYTES) {
      throw new MediaValidationError('The processed image exceeds 5 MB');
    }
    const id = this.runtime.nextId();
    const storageKey = `${id}.${image.extension}`;
    await this.storage.write(storageKey, image.original, image.thumbnail);
    let asset: MediaAsset;
    try {
      asset = await this.assets.create(
        {
          id,
          shopId,
          ownerId: actor.userId,
          status: 'READY',
          storageKey,
          mimeType: image.mimeType,
          byteSize: image.original.byteLength,
          width: image.width,
          height: image.height,
          createdAt: this.runtime.now(),
        },
        actor,
      );
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    return {
      ...this.resolve(asset),
      shopId: asset.shopId,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
    };
  }

  async resolveForShop(
    shopId: string | null,
    actor: MediaActor,
    assetIds: readonly string[],
  ): Promise<ResolvedMediaAsset[]> {
    await this.authorize(shopId, actor);
    if (
      !Array.isArray(assetIds) ||
      assetIds.length > 1000 ||
      assetIds.some((id) => typeof id !== 'string' || !uuid.test(id))
    ) {
      throw new MediaValidationError(
        'Media references must be valid asset UUIDs',
      );
    }
    const ids = [...new Set(assetIds)];
    const assets = await this.assets.findByIds(ids);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return ids.map((id) => {
      const asset = byId.get(id);
      if (!asset || asset.status !== 'READY') throw new MediaNotFoundError();
      if (asset.shopId !== shopId) {
        throw new MediaForbiddenError();
      }
      return this.resolve(asset);
    });
  }

  async read(id: string, thumbnail: boolean) {
    if (!uuid.test(id)) throw new MediaNotFoundError();
    const asset = await this.assets.findById(id);
    if (!asset || asset.status !== 'READY') throw new MediaNotFoundError();
    return {
      bytes: await this.storage.read(asset.storageKey, thumbnail),
      mimeType: thumbnail ? 'image/webp' : asset.mimeType,
    };
  }

  async delete(id: string, actor: MediaActor): Promise<void> {
    if (!uuid.test(id)) throw new MediaNotFoundError();
    const asset = await this.assets.findById(id);
    if (!asset || asset.status !== 'READY') throw new MediaNotFoundError();
    await this.authorize(asset.shopId, actor);
    await this.assets.deleteUnused(id, actor);
    // The database status is authoritative; failed cleanup leaves no public URL.
    await this.storage.remove(asset.storageKey).catch(() => undefined);
  }

  private async authorize(
    shopId: string | null,
    actor: MediaActor,
  ): Promise<void> {
    if (
      !actor ||
      typeof actor.userId !== 'string' ||
      !actor.userId ||
      !['USER', 'ADMIN'].includes(actor.role)
    ) {
      throw new MediaForbiddenError('An authenticated actor is required');
    }
    if (shopId === null) {
      if (actor.role !== 'ADMIN')
        throw new MediaForbiddenError(
          'Platform media requires administrator access',
        );
      return;
    }
    if (typeof shopId !== 'string' || !uuid.test(shopId))
      throw new MediaValidationError('Invalid media shop identifier');
    await this.shops.requireManageable(shopId, actor);
  }

  private resolve(asset: MediaAsset): ResolvedMediaAsset {
    const base = `${this.publicBaseUrl}/media/assets/${asset.id}`;
    return {
      id: asset.id,
      url: `${base}/original`,
      thumbnailUrl: `${base}/thumbnail`,
    };
  }
}
