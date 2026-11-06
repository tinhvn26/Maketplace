import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsUUID, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { MediaService } from '../application/media.service.js';
import type { MediaActor } from '../contracts/media.api.js';
import { MEDIA_MAX_BYTES } from '../domain/media-asset.js';
import { MediaValidationError } from '../domain/media.errors.js';
import type { AuthenticatedRequest } from '../../identity/presentation/http/guards/access-token.guard.js';
import { MediaAuthenticatedGuard } from './media-authenticated.guard.js';
import { MediaExceptionFilter } from './media-exception.filter.js';

class UploadMediaRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  shopId?: string;
}

interface UploadedImage {
  buffer: Buffer;
}

@Controller('media/assets')
@UseGuards(MediaAuthenticatedGuard)
@UseFilters(MediaExceptionFilter)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 1, parts: 2 },
    }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Body() body: UploadMediaRequest,
    @UploadedFile() file?: UploadedImage,
  ) {
    if (!file) throw new MediaValidationError('An image file is required');
    return this.media.upload(
      body.shopId ?? null,
      this.actor(request),
      file.buffer,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.media.delete(id, this.actor(request));
  }

  private actor(request: AuthenticatedRequest): MediaActor {
    if (
      !request.userId ||
      (request.role !== 'ADMIN' && request.role !== 'USER')
    )
      throw new UnauthorizedException();
    return { userId: request.userId, role: request.role };
  }
}

@Controller('media/assets')
@UseFilters(MediaExceptionFilter)
export class MediaPublicController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/original')
  async original(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(id, false, response);
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(id, true, response);
  }

  private async file(id: string, thumbnail: boolean, response: Response) {
    const image = await this.media.read(id, thumbnail);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=300');
    return new StreamableFile(Buffer.from(image.bytes), {
      type: image.mimeType,
      length: image.bytes.byteLength,
    });
  }
}
