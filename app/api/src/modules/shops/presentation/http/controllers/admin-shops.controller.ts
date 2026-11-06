import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AdminRoleGuard } from '../../../../identity/presentation/http/guards/admin-role.guard.js';
import { ShopsService } from '../../../application/shops.service.js';
import type { ShopActor } from '../../../contracts/shops.api.js';
import { CurrentShopActor } from '../decorators/shop-actor.decorator.js';
import { UpdateShopStatusRequest } from '../dto/shops.requests.js';
import { ShopsExceptionFilter } from '../filters/shops-exception.filter.js';
import { ShopsAuthenticatedGuard } from '../guards/shops-authenticated.guard.js';

@Controller('admin/shops')
@UseGuards(ShopsAuthenticatedGuard, AdminRoleGuard)
@UseFilters(ShopsExceptionFilter)
export class AdminShopsController {
  constructor(private readonly shops: ShopsService) {}
  @Patch(':id/status')
  status(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateShopStatusRequest,
    @CurrentShopActor() actor: ShopActor,
  ) {
    return this.shops.setStatus(id, input, actor);
  }
}
