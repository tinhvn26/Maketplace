import { Body, Controller, HttpCode, Post, UseFilters } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CatalogQuoteService } from '../../../application/quote/catalog-quote.service.js';
import { CatalogExceptionFilter } from '../filters/catalog-exception.filter.js';

class QuoteItemRequest {
  @IsUUID('4', {
    message: '$property phải là UUID phiên bản $constraint1 hợp lệ',
  })
  variantId!: string;
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(1, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(999, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  quantity!: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  expectedProductVersion?: number;
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: '$property phải là số nguyên' })
  @Min(0, { message: '$property phải lớn hơn hoặc bằng $constraint1' })
  @Max(2147483647, { message: '$property phải nhỏ hơn hoặc bằng $constraint1' })
  expectedUnitPriceAmount?: number;
}
class QuoteRequest {
  @IsArray({ message: '$property phải là mảng' })
  @ArrayMinSize(1, {
    message: '$property phải có ít nhất $constraint1 phần tử',
  })
  @ArrayMaxSize(100, {
    message: '$property không được có quá $constraint1 phần tử',
  })
  @ValidateNested({
    each: true,
    message: 'Mỗi phần tử của $property phải là đối tượng hợp lệ',
  })
  @Type(() => QuoteItemRequest)
  lines!: QuoteItemRequest[];
}

@Controller('catalog')
@UseFilters(CatalogExceptionFilter)
export class CatalogQuoteController {
  constructor(private readonly quotes: CatalogQuoteService) {}
  @Post('quote')
  @HttpCode(200)
  quote(@Body() input: QuoteRequest) {
    return this.quotes.quote(input);
  }
}
