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
import { OrderFulfilmentService } from '../../../application/fulfilment/order-fulfilment.service.js';
import type { OrderActor } from '../../../application/ports/order-unit-of-work.js';
import { CurrentOrderActor } from '../decorators/order-actor.decorator.js';
import {
  OrderListQuery,
  OrderVersionRequest,
  SellerCancelRequest,
} from '../dto/orders.requests.js';
import { OrdersExceptionFilter } from '../filters/orders-exception.filter.js';
import { OrdersAuthenticatedGuard } from '../guards/orders-authenticated.guard.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const shop = (shopId: string) => ({ kind: 'shop', shopId }) as const;

/** A shop owner (or administrator) working on one shop's orders. */
@Controller('seller/shops/:shopId/orders')
@UseGuards(OrdersAuthenticatedGuard)
@UseFilters(OrdersExceptionFilter)
export class SellerOrdersController {
  constructor(private readonly orders: OrderFulfilmentService) {}

  @Get()
  list(
    @Param('shopId', uuid) shopId: string,
    @Query() query: OrderListQuery,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.list(shop(shopId), actor, query);
  }

  @Get(':id')
  get(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.get(shop(shopId), id, actor);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.confirm(shop(shopId), id, input, actor);
  }

  @Post(':id/ship')
  @HttpCode(200)
  ship(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.ship(shop(shopId), id, input, actor);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @Body() input: OrderVersionRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.deliver(shop(shopId), id, input, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @Body() input: SellerCancelRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.orders.cancel(shop(shopId), id, input, actor);
  }
}
