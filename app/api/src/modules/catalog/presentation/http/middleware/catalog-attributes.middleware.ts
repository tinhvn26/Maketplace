import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CatalogValidationError } from '../../../domain/errors/catalog.errors.js';
import { normalizeVariantAttributes } from '../../../domain/value-objects/variant-attributes.js';

/** Validate raw maps before ValidationPipe removes reserved object keys. */
@Injectable()
export class CatalogAttributesMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    response.setHeader('Cache-Control', 'no-store');
    const body: unknown = request.body;
    if (
      typeof body === 'object' &&
      body !== null &&
      Object.hasOwn(body, 'attributes')
    ) {
      try {
        // Validation only: application/domain still owns normalization.
        normalizeVariantAttributes(
          (body as Record<string, unknown>).attributes,
        );
      } catch (error) {
        if (!(error instanceof CatalogValidationError)) throw error;
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: error.message,
          error: 'Bad Request',
          code: error.code,
        });
      }
    }
    next();
  }
}
