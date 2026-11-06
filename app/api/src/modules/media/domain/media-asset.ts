export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_PIXELS = 40_000_000;
export const MEDIA_MAX_DIMENSION = 12_000;

export interface MediaAsset {
  id: string;
  shopId: string | null;
  ownerId: string;
  status: 'READY' | 'DELETED';
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: Date;
}
