export const MEDIA_ASSETS = Symbol('MEDIA_ASSETS');

export interface MediaActor {
  userId: string;
  role: 'USER' | 'ADMIN';
}

export interface ResolvedMediaAsset {
  id: string;
  url: string;
  thumbnailUrl: string;
}

export interface MediaAssets {
  resolveForShop(
    shopId: string | null,
    actor: MediaActor,
    assetIds: readonly string[],
  ): Promise<ResolvedMediaAsset[]>;
}

export {
  MediaValidationError,
  MediaNotFoundError,
  MediaForbiddenError,
  MediaInUseError,
} from '../domain/media.errors.js';
