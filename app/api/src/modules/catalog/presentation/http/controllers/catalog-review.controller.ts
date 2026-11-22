import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { AuthenticatedRequest } from '../../../../identity/contracts/identity.http.js';
import { CatalogReviewService } from '../../../application/review/catalog-review.service.js';
import { ProductVersionRequest } from '../dto/catalog.requests.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';
import { CatalogAdminGuard } from '../guards/catalog-admin.guard.js';
import { catalogActor } from '../catalog-actor.js';
class ReviewQuery {
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'], {
    message: '$property phải là một trong các giá trị: $constraint1',
  })
  status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(1, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(100, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  limit = 20;
}
class AuditQuery {
  @Type(() => Number)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(1, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(100, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  limit = 20;
}
class ReviewDecisionRequest extends ProductVersionRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: '$property phải là chuỗi' })
  @MaxLength(1000, {
    message: '$property không được vượt quá $constraint1 ký tự',
  })
  note?: string;
}
@Controller('admin/catalog')
@UseGuards(CatalogAdminGuard)
@UseFilters(CatalogExceptionFilter)
export class CatalogReviewController {
  constructor(private readonly reviews: CatalogReviewService) {}
  @Get('reviews') list(
    @Query() query: ReviewQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.list(query.status, query.limit, catalogActor(request));
  }
  @Post('reviews/:id/approve') @HttpCode(200) approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ReviewDecisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.decide(
      id,
      body.version,
      true,
      body.note,
      catalogActor(request),
    );
  }
  @Post('reviews/:id/reject') @HttpCode(200) reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ReviewDecisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.decide(
      id,
      body.version,
      false,
      body.note,
      catalogActor(request),
    );
  }
  @Get('products/:id/audit') audit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: AuditQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviews.audit(id, query.limit, catalogActor(request));
  }
}
