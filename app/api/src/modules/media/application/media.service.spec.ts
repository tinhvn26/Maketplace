import { describe, expect, it, vi } from 'vitest';
import type { MediaActor } from '../contracts/media.api.js';
import type { MediaAsset } from '../domain/media-asset.js';
import {
  MediaForbiddenError,
  MediaInUseError,
} from '../domain/media.errors.js';
import type {
  MediaImageProcessor,
  MediaRepository,
  MediaShopAccess,
  MediaStorage,
} from './media.ports.js';
import { MediaService } from './media.service.js';

const id = '44444444-4444-4444-8444-444444444444';
const userId = '11111111-1111-4111-8111-111111111111';
const shopId = '33333333-3333-4333-8333-333333333333';
const actor: MediaActor = { userId, role: 'USER' };
const row = (scope: string | null = shopId): MediaAsset => ({
  id,
  shopId: scope,
  ownerId: userId,
  status: 'READY',
  storageKey: `${id}.png`,
  mimeType: 'image/png',
  byteSize: 3,
  width: 2,
  height: 2,
  createdAt: new Date(),
});

function fixture() {
  const create = vi.fn<MediaRepository['create']>().mockResolvedValue(row());
  const findById = vi
    .fn<MediaRepository['findById']>()
    .mockResolvedValue(row());
  const findByIds = vi
    .fn<MediaRepository['findByIds']>()
    .mockResolvedValue([row()]);
  const deleteUnused = vi
    .fn<MediaRepository['deleteUnused']>()
    .mockResolvedValue();
  const write = vi.fn<MediaStorage['write']>().mockResolvedValue();
  const remove = vi.fn<MediaStorage['remove']>().mockResolvedValue();
  const storage: MediaStorage = { write, read: vi.fn(), remove };
  const process = vi.fn<MediaImageProcessor['process']>().mockResolvedValue({
    original: new Uint8Array([1, 2, 3]),
    thumbnail: new Uint8Array([4]),
    extension: 'png',
    mimeType: 'image/png',
    width: 2,
    height: 2,
  });
  const images: MediaImageProcessor = { process };
  const requireManageable = vi
    .fn<MediaShopAccess['requireManageable']>()
    .mockResolvedValue(undefined);
  const shops: MediaShopAccess = { requireManageable };
  const service = new MediaService(
    { create, findById, findByIds, deleteUnused },
    storage,
    images,
    shops,
    { nextId: () => id, now: () => new Date() },
    'https://assets.example.test',
  );
  return {
    service,
    create,
    findById,
    findByIds,
    deleteUnused,
    storage,
    images,
    shops,
    write,
    remove,
    process,
    requireManageable,
  };
}

describe('MediaService ownership and persistence boundaries', () => {
  it('resolves only ready assets belonging to exactly the target shop', async () => {
    const test = fixture();
    await expect(
      test.service.resolveForShop(shopId, actor, [id]),
    ).resolves.toEqual([
      {
        id,
        url: `https://assets.example.test/media/assets/${id}/original`,
        thumbnailUrl: `https://assets.example.test/media/assets/${id}/thumbnail`,
      },
    ]);
    expect(test.requireManageable).toHaveBeenCalledWith(shopId, actor);
    test.findByIds.mockResolvedValue([
      row('55555555-5555-4555-8555-555555555555'),
    ]);
    await expect(
      test.service.resolveForShop(shopId, actor, [id]),
    ).rejects.toBeInstanceOf(MediaForbiddenError);
  });

  it('does not reuse platform assets in a shop even for an administrator', async () => {
    const test = fixture();
    test.findByIds.mockResolvedValue([row(null)]);
    const admin: MediaActor = { userId, role: 'ADMIN' };
    await expect(
      test.service.resolveForShop(shopId, admin, [id]),
    ).rejects.toBeInstanceOf(MediaForbiddenError);
    await expect(
      test.service.resolveForShop(null, admin, [id]),
    ).resolves.toHaveLength(1);
  });

  it('rejects unauthorized platform uploads before decoding or writing a file', async () => {
    const test = fixture();
    await expect(
      test.service.upload(null, actor, new Uint8Array([1])),
    ).rejects.toBeInstanceOf(MediaForbiddenError);
    expect(test.process).not.toHaveBeenCalled();
    expect(test.write).not.toHaveBeenCalled();
    expect(test.create).not.toHaveBeenCalled();
  });

  it('removes written files if final live authorization or asset persistence fails', async () => {
    const test = fixture();
    test.create.mockRejectedValue(new MediaForbiddenError());
    await expect(
      test.service.upload(shopId, actor, new Uint8Array([1])),
    ).rejects.toBeInstanceOf(MediaForbiddenError);
    expect(test.create).toHaveBeenCalledWith(
      expect.objectContaining({ id, shopId, ownerId: userId }),
      actor,
    );
    expect(test.remove).toHaveBeenCalledWith(`${id}.png`);
  });

  it('retains the files when a reference prevents deletion', async () => {
    const test = fixture();
    test.deleteUnused.mockRejectedValue(new MediaInUseError());
    await expect(test.service.delete(id, actor)).rejects.toBeInstanceOf(
      MediaInUseError,
    );
    expect(test.deleteUnused).toHaveBeenCalledWith(id, actor);
    expect(test.remove).not.toHaveBeenCalled();
  });
});
