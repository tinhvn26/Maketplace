import type { MediaActor } from '../contracts/media.api.js';
import type { MediaAsset } from '../domain/media-asset.js';

export interface MediaRepository {
  create(asset: MediaAsset, actor: MediaActor): Promise<MediaAsset>;
  findById(id: string): Promise<MediaAsset | null>;
  findByIds(ids: readonly string[]): Promise<MediaAsset[]>;
  /** Atomically marks READY -> DELETED only when no usage rows exist. */
  deleteUnused(id: string, actor: MediaActor): Promise<void>;
}

export interface MediaStorage {
  write(
    key: string,
    original: Uint8Array,
    thumbnail: Uint8Array,
  ): Promise<void>;
  read(key: string, thumbnail: boolean): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

export interface ProcessedMediaImage {
  original: Uint8Array;
  thumbnail: Uint8Array;
  extension: 'png' | 'jpg' | 'webp';
  mimeType: string;
  width: number;
  height: number;
}

export interface MediaImageProcessor {
  process(bytes: Uint8Array): Promise<ProcessedMediaImage>;
}

export interface MediaShopAccess {
  requireManageable(shopId: string, actor: MediaActor): Promise<unknown>;
}

export interface MediaRuntime {
  nextId(): string;
  now(): Date;
}
