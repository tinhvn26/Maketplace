import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { MediaModule } from '../src/modules/media/media.module.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

interface UploadedAsset {
  id: string;
  url: string;
  thumbnailUrl: string;
  shopId: string | null;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
}

describe('Media upload, image delivery and usage protection', () => {
  const temporaryPrefix = 'marketplate-media-e2e-';
  let test: IdentityTestApp;
  let directory: string;
  let owner: { id: string; token: string };
  let shopId: string;
  let images: Record<'png' | 'jpeg' | 'webp', Buffer>;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), temporaryPrefix));
    vi.stubEnv('MEDIA_STORAGE_PATH', directory);
    vi.stubEnv('MEDIA_PUBLIC_BASE_URL', 'http://media.example.test');
    // These are real compressed images; the HTTP pipeline must decode pixels.
    const entries = await Promise.all(
      (['png', 'jpeg', 'webp'] as const).map(
        async (format) =>
          [
            format,
            await sharp({
              create: {
                width: 1200,
                height: 800,
                channels: 3,
                background: { r: 20, g: 100, b: 180 },
              },
            })
              .withMetadata({ orientation: 1 })
              .toFormat(format)
              .toBuffer(),
          ] as const,
      ),
    );
    images = Object.fromEntries(entries) as typeof images;
    test = await createIdentityTestApp([MediaModule]);
  }, 15_000);

  beforeEach(async () => {
    await test.reset();
    const user = await test.register('media-owner@example.com');
    owner = {
      id: user.id,
      token: (await test.login('media-owner@example.com')).accessToken,
    };
    const response = await test
      .http()
      .post('/shops')
      .auth(owner.token, { type: 'bearer' })
      .send({ name: 'Media Shop', slug: 'media-shop' })
      .expect(201);
    shopId = response.body.id as string;
  }, 15_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await test?.close();
    } catch (error) {
      errors.push(error);
    }
    vi.unstubAllEnvs();
    try {
      if (directory) {
        const target = resolve(directory);
        if (
          dirname(target) !== resolve(tmpdir()) ||
          !basename(target).startsWith(temporaryPrefix)
        ) {
          throw new Error(
            'Refusing to remove files outside the media test workspace',
          );
        }
        await rm(target, { recursive: true, force: true });
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0)
      throw new AggregateError(errors, 'Media test cleanup failed');
  });

  const upload = (
    bytes: Buffer,
    token = owner.token,
    targetShop: string | null = shopId,
    contentType = 'image/png',
    filename = 'image.png',
  ) => {
    const request = test
      .http()
      .post('/media/assets')
      .auth(token, { type: 'bearer' });
    if (targetShop !== null) request.field('shopId', targetShop);
    return request.attach('file', bytes, { filename, contentType });
  };

  const filesFor = async (id: string) => {
    const asset = await test.prisma.mediaAsset.findUniqueOrThrow({
      where: { id },
    });
    return [
      join(directory, asset.storageKey),
      join(directory, `${asset.storageKey}.thumbnail.webp`),
    ];
  };

  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes %s uploads and serves the original plus a smaller WebP thumbnail',
    async (format) => {
      const contentType = `image/${format}`;
      const response = await upload(
        images[format],
        owner.token,
        shopId,
        contentType,
        `sample.${format}`,
      )
        .expect(201)
        .expect('Cache-Control', 'no-store');
      const asset = response.body as UploadedAsset;
      expect(asset).toMatchObject({
        shopId,
        mimeType: contentType,
        width: 1200,
        height: 800,
        byteSize: expect.any(Number),
      });
      expect(Object.keys(asset).sort()).toEqual(
        [
          'id',
          'url',
          'thumbnailUrl',
          'shopId',
          'mimeType',
          'byteSize',
          'width',
          'height',
        ].sort(),
      );
      expect(asset.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new URL(asset.url).pathname).toBe(
        `/media/assets/${asset.id}/original`,
      );
      expect(new URL(asset.thumbnailUrl).pathname).toBe(
        `/media/assets/${asset.id}/thumbnail`,
      );
      const original = await test
        .http()
        .get(new URL(asset.url).pathname)
        .expect(200)
        .expect('Content-Type', contentType)
        .expect('X-Content-Type-Options', 'nosniff');
      expect(Buffer.isBuffer(original.body)).toBe(true);
      expect(original.body.length).toBe(asset.byteSize);
      const originalMetadata = await sharp(original.body as Buffer).metadata();
      expect(originalMetadata).toMatchObject({
        width: 1200,
        height: 800,
        format,
      });
      expect(originalMetadata.exif).toBeUndefined();

      const thumbnail = await test
        .http()
        .get(new URL(asset.thumbnailUrl).pathname)
        .expect(200)
        .expect('Content-Type', 'image/webp')
        .expect('X-Content-Type-Options', 'nosniff');
      const thumbnailMetadata = await sharp(
        thumbnail.body as Buffer,
      ).metadata();
      expect(thumbnailMetadata.format).toBe('webp');
      expect(thumbnailMetadata.width).toBe(320);
      expect(thumbnailMetadata.height).toBeGreaterThan(0);
      expect(thumbnailMetadata.height).toBeLessThan(800);
      expect(thumbnailMetadata.height).toBeLessThanOrEqual(320);
    },
  );

  it('uses decoded content rather than attacker-controlled MIME and file names', async () => {
    const marker = Buffer.from('untrusted trailing metadata must be discarded');
    const response = await upload(
      Buffer.concat([images.png, marker]),
      owner.token,
      shopId,
      'text/html',
      '../../payload.html',
    ).expect(201);
    expect(response.body.mimeType).toBe('image/png');
    const original = await test
      .http()
      .get(new URL((response.body as UploadedAsset).url).pathname)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect('X-Content-Type-Options', 'nosniff');
    expect((original.body as Buffer).includes(marker)).toBe(false);
    await upload(Buffer.from('<script>alert(1)</script>')).expect(400);
    expect(await test.prisma.mediaAsset.count()).toBe(1);
  });

  it('rejects malformed bytes, empty uploads, missing files and oversized multipart files without persisting assets', async () => {
    const filesBefore = await readdir(directory);
    await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])).expect(400);
    await upload(Buffer.alloc(0)).expect(400);
    await test
      .http()
      .post('/media/assets')
      .auth(owner.token, { type: 'bearer' })
      .field('shopId', shopId)
      .expect(400);
    await upload(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
    expect(await test.prisma.mediaAsset.count()).toBe(0);
    expect(await readdir(directory)).toEqual(filesBefore);
  });

  it('rejects another shop owner and rechecks ownership after an asset was uploaded', async () => {
    const other = await test.register('other-media-owner@example.com');
    const token = (await test.login('other-media-owner@example.com'))
      .accessToken;
    const otherShop = await test
      .http()
      .post('/shops')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Other Shop', slug: 'other-media-shop' })
      .expect(201);
    await upload(images.png, owner.token, otherShop.body.id as string).expect(
      403,
    );
    const response = await upload(images.png).expect(201);
    const asset = response.body as UploadedAsset;
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(token, { type: 'bearer' })
      .expect(403);

    await test.prisma.shop.update({
      where: { id: shopId },
      data: { ownerId: other.id },
    });
    await upload(images.png).expect(403);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(403);
    for (const path of await filesFor(asset.id))
      await expect(access(path)).resolves.toBeUndefined();
    await test.http().get(new URL(asset.url).pathname).expect(200);
  });

  it('requires current administrator access for platform media and immediately observes demotion', async () => {
    await upload(images.png, owner.token, null).expect(403);
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { role: 'ADMIN' },
    });
    const adminToken = (await test.login('media-owner@example.com'))
      .accessToken;
    const response = await upload(images.png, adminToken, null).expect(201);
    const asset = response.body as UploadedAsset;
    expect(asset.shopId).toBeNull();
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { role: 'USER' },
    });
    await upload(images.png, adminToken, null).expect(403);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(403);
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { authVersion: { increment: 1 } },
    });
    await upload(images.png, adminToken, null).expect(401);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(401);
    expect(
      (
        await test.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        })
      ).status,
    ).toBe('READY');
  });

  it('rejects missing authentication, revoked sessions and inactive shop owners', async () => {
    const response = await upload(images.png).expect(201);
    const asset = response.body as UploadedAsset;
    await test
      .http()
      .post('/media/assets')
      .field('shopId', shopId)
      .attach('file', images.png, {
        filename: 'image.png',
        contentType: 'image/png',
      })
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await test.http().delete(`/media/assets/${asset.id}`).expect(401);
    await test.prisma.authSession.updateMany({
      where: { userId: owner.id },
      data: { revokedAt: new Date() },
    });
    await upload(images.png).expect(401);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(401);
    owner.token = (await test.login('media-owner@example.com')).accessToken;
    await test.prisma.user.update({
      where: { id: owner.id },
      data: { status: 'LOCKED' },
    });
    await upload(images.png).expect(401);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(401);
    expect(await test.prisma.mediaAsset.count()).toBe(1);
  });

  it('prevents writes for a suspended shop without creating an asset', async () => {
    await test.prisma.shop.update({
      where: { id: shopId },
      data: { status: 'SUSPENDED' },
    });
    await upload(images.png).expect(409);
    expect(await test.prisma.mediaAsset.count()).toBe(0);
  });

  it('deletes an unused asset and both files, and invalidates both public URLs', async () => {
    const response = await upload(images.png).expect(201);
    const asset = response.body as UploadedAsset;
    const paths = await filesFor(asset.id);
    for (const path of paths)
      await expect(access(path)).resolves.toBeUndefined();
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(204)
      .expect('Cache-Control', 'no-store');
    for (const path of paths)
      await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await test.http().get(new URL(asset.url).pathname).expect(404);
    await test.http().get(new URL(asset.thumbnailUrl).pathname).expect(404);
    await test
      .http()
      .delete(`/media/assets/${asset.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(404);
    expect(
      (
        await test.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        })
      ).status,
    ).toBe('DELETED');
  });

  it('retains files while any usage remains, then allows deletion after the last usage is cancelled', async () => {
    const response = await upload(images.png).expect(201);
    const asset = response.body as UploadedAsset;
    const paths = await filesFor(asset.id);
    const productId = randomUUID();
    const reviewId = randomUUID();
    await test.prisma.mediaUsage.createMany({
      data: [
        { assetId: asset.id, resourceId: productId, kind: 'CATALOG_PRODUCT' },
        { assetId: asset.id, resourceId: reviewId, kind: 'CATALOG_REVIEW' },
      ],
    });
    const remove = () =>
      test
        .http()
        .delete(`/media/assets/${asset.id}`)
        .auth(owner.token, { type: 'bearer' });
    await remove().expect(409);
    for (const path of paths)
      await expect(access(path)).resolves.toBeUndefined();
    await test.http().get(new URL(asset.url).pathname).expect(200);
    await test.prisma.mediaUsage.deleteMany({
      where: { assetId: asset.id, resourceId: productId },
    });
    await remove().expect(409);
    for (const path of paths)
      await expect(access(path)).resolves.toBeUndefined();
    expect(
      (
        await test.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        })
      ).status,
    ).toBe('READY');
    await test.prisma.mediaUsage.deleteMany({
      where: { assetId: asset.id, resourceId: reviewId },
    });
    await remove().expect(204);
    for (const path of paths)
      await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await test.http().get(new URL(asset.url).pathname).expect(404);
    await test.http().get(new URL(asset.thumbnailUrl).pathname).expect(404);
  });
});
