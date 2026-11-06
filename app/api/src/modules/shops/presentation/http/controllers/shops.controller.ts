import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ShopsService } from '../../../application/shops.service.js';
import type { ShopActor } from '../../../contracts/shops.api.js';
import { CurrentShopActor } from '../decorators/shop-actor.decorator.js';
import { CreateShopRequest, UpdateShopRequest } from '../dto/shops.requests.js';
import { ShopsExceptionFilter } from '../filters/shops-exception.filter.js';
import { ShopsAuthenticatedGuard } from '../guards/shops-authenticated.guard.js';

@Controller('shops')
@UseFilters(ShopsExceptionFilter)
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Post()
  @UseGuards(ShopsAuthenticatedGuard)
  create(
    @Body() input: CreateShopRequest,
    @CurrentShopActor() actor: ShopActor,
  ) {
    return this.shops.create(input, actor);
  }

  @Get('me')
  @UseGuards(ShopsAuthenticatedGuard)
  mine(@CurrentShopActor() actor: ShopActor) {
    return this.shops.listMine(actor);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.shops.getPublic(id);
  }

  @Patch(':id')
  @UseGuards(ShopsAuthenticatedGuard)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateShopRequest,
    @CurrentShopActor() actor: ShopActor,
  ) {
    return this.shops.update(id, input, actor);
  }
}
