import sharp from 'sharp';
import type {
  MediaImageProcessor,
  ProcessedMediaImage,
} from '../application/media.ports.js';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_DIMENSION,
  MEDIA_MAX_PIXELS,
} from '../domain/media-asset.js';
import { MediaValidationError } from '../domain/media.errors.js';

export class SharpImageProcessor implements MediaImageProcessor {
  async process(bytes: Uint8Array): Promise<ProcessedMediaImage> {
    if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_MAX_BYTES)
      throw new MediaValidationError(
        'Images must contain between 1 byte and 5 MB',
      );
    try {
      const input = Buffer.from(bytes);
      const options = {
        limitInputPixels: MEDIA_MAX_PIXELS,
        failOn: 'warning' as const,
      };
      const metadata = await sharp(input, options).metadata();
      if (
        !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > MEDIA_MAX_DIMENSION ||
        metadata.height > MEDIA_MAX_DIMENSION ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new MediaValidationError(
          'Upload a single PNG, JPEG or WebP image within the dimension limits',
        );
      }
      const format = metadata.format as 'png' | 'jpeg' | 'webp';
      // Decode and re-encode to validate actual pixels and remove metadata/trailing data.
      const original = await sharp(input, options)
        .rotate()
        .toFormat(format)
        .toBuffer({ resolveWithObject: true });
      if (original.data.byteLength > MEDIA_MAX_BYTES)
        throw new MediaValidationError('The processed image exceeds 5 MB');
      const thumbnail = await sharp(original.data, options)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
      return {
        original: original.data,
        thumbnail,
        extension: format === 'jpeg' ? 'jpg' : format,
        mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
        width: original.info.width,
        height: original.info.height,
      };
    } catch (error) {
      if (error instanceof MediaValidationError) throw error;
      throw new MediaValidationError('The image could not be decoded safely');
    }
  }
}
