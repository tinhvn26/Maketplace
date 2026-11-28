import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AdminRoleGuard } from '../../../../identity/contracts/identity.http.js';
import { OrderFulfilmentService } from '../../../application/fulfilment/order-fulfilment.service.js';
import type { OrderActor } from '../../../application/ports/order-unit-of-work.js';
import { CurrentOrderActor } from '../decorators/order-actor.decorator.js';
import {
  AdminOrderListQuery,
  OrderVersionRequest,
  SellerCancelRequest,
} from '../dto/orders.requests.js';
import { OrdersExceptionFilter } from '../filters/orders-exception.filter.js';
import { OrdersAuthenticatedGuard } from '../guards/orders-authenticated.guard.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const admin = { kind: 'admin' } as const;

/** Administrators working on every order, platform and locked-shop orders included. */
@Controller('admin/orders')
@UseGuards(OrdersAuthenticatedGuard, AdminRoleGuard)
@UseFilters(OrdersExceptionFilter)
export class AdminOrdersController {
  constructor(private readonly orders: OrderFulfilmentService) {}

  @Get()
  list(
    @Query() query: AdminOrderListQuery,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.list(admin, actor, {
      status: query.status,
      page: query.page,
      limit: query.limit,
      buyerId: query.buyerId,
      shopId: query.shopId === 'platform' ? null : query.shopId,
    });
  }

  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentOrderActor() actor: OrderActor) {
    return this.orders.get(admin, id, actor);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.confirm(admin, id, input, actor);
  }

  @Post(':id/ship')
  @HttpCode(200)
  ship(
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.ship(admin, id, input, actor);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.deliver(admin, id, input, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body() input: SellerCancelRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.cancel(admin, id, input, actor);
  }
}
