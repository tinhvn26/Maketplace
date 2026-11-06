import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_BYTES } from '../domain/media-asset.js';
import { MediaValidationError } from '../domain/media.errors.js';
import { SharpImageProcessor } from './sharp-image.processor.js';

describe('SharpImageProcessor', () => {
  const processor = new SharpImageProcessor();

  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes real %s pixels and creates a real bounded WebP thumbnail',
    async (format) => {
      const bytes = await sharp({
        create: { width: 640, height: 160, channels: 3, background: '#2266aa' },
      })
        .toFormat(format)
        .toBuffer();
      const processed = await processor.process(bytes);
      const original = await sharp(processed.original).metadata();
      const thumbnail = await sharp(processed.thumbnail).metadata();
      expect(original).toMatchObject({ format, width: 640, height: 160 });
      expect(thumbnail).toMatchObject({
        format: 'webp',
        width: 320,
        height: 80,
      });
      expect(processed.mimeType).toBe(
        format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
      );
      expect(processed.original.byteLength).toBeLessThanOrEqual(
        MEDIA_MAX_BYTES,
      );
    },
  );

  it('rejects text, SVG and incomplete images instead of trusting a filename or MIME type', async () => {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    for (const bytes of [
      Buffer.from('fake image.png'),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      ),
      png.subarray(0, 25),
    ]) {
      await expect(processor.process(bytes)).rejects.toBeInstanceOf(
        MediaValidationError,
      );
    }
  });

  it('rejects empty, oversized and over-dimension inputs', async () => {
    const wide = await sharp({
      create: { width: 12001, height: 1, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(MEDIA_MAX_BYTES + 1),
      wide,
    ]) {
      await expect(processor.process(bytes)).rejects.toBeInstanceOf(
        MediaValidationError,
      );
    }
  });
});
