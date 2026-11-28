import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { OrderBuyerService } from '../../../application/buyer/order-buyer.service.js';
import { OrderCheckoutService } from '../../../application/checkout/order-checkout.service.js';
import type { OrderActor } from '../../../application/ports/order-unit-of-work.js';
import { CurrentOrderActor } from '../decorators/order-actor.decorator.js';
import {
  BuyerCancelRequest,
  OrderListQuery,
  PlaceOrderRequest,
} from '../dto/orders.requests.js';
import { OrdersExceptionFilter } from '../filters/orders-exception.filter.js';
import { OrdersAuthenticatedGuard } from '../guards/orders-authenticated.guard.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** A buyer placing and following their own orders. */
@Controller('orders')
@UseGuards(OrdersAuthenticatedGuard)
@UseFilters(OrdersExceptionFilter)
export class OrdersController {
  constructor(
    private readonly checkout: OrderCheckoutService,
    private readonly buyer: OrderBuyerService,
  ) {}

  @Post()
  async place(
    @Body() input: PlaceOrderRequest,
    @CurrentOrderActor() actor: OrderActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { created, checkoutId, orders } = await this.checkout.place(
      input,
      actor,
    );
    response.status(created ? 201 : 200);
    return { checkoutId, orders };
  }

  @Get()
  list(@Query() query: OrderListQuery, @CurrentOrderActor() actor: OrderActor) {
    return this.buyer.list(actor, query);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentOrderActor() actor: OrderActor) {
    return this.buyer.get(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', uuid) id: string,
    @Body() input: BuyerCancelRequest,
    @CurrentOrderActor() actor: OrderActor,
  ) {
    return this.buyer.cancel(id, input, actor);
  }
}
