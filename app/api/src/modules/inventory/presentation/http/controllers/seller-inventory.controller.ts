import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ShopActor } from '../../../../shops/contracts/shops.api.js';
import { InventoryStockService } from '../../../application/stock/inventory-stock.service.js';
import { InventoryWarehouseService } from '../../../application/warehouses/inventory-warehouse.service.js';
import { CurrentInventoryActor } from '../decorators/inventory-actor.decorator.js';
import {
  AdjustStockRequest,
  CreateWarehouseRequest,
  ReceiveStockRequest,
  StockQuery,
  TransferStockRequest,
  UpdateWarehouseRequest,
} from '../dto/inventory.requests.js';
import { InventoryExceptionFilter } from '../filters/inventory-exception.filter.js';
import { InventoryAuthenticatedGuard } from '../guards/inventory-authenticated.guard.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** A shop owner (or administrator) managing one shop's warehouses and stock. */
@Controller('seller/shops/:shopId/inventory')
@UseGuards(InventoryAuthenticatedGuard)
@UseFilters(InventoryExceptionFilter)
export class SellerInventoryController {
  constructor(
    private readonly warehouses: InventoryWarehouseService,
    private readonly stock: InventoryStockService,
  ) {}

  @Post('warehouses')
  createWarehouse(
    @Param('shopId', uuid) shopId: string,
    @Body() input: CreateWarehouseRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.warehouses.create({ shopId }, input, actor);
  }

  @Get('warehouses')
  listWarehouses(
    @Param('shopId', uuid) shopId: string,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.warehouses.list({ shopId }, actor);
  }

  @Patch('warehouses/:id')
  updateWarehouse(
    @Param('shopId', uuid) shopId: string,
    @Param('id', uuid) id: string,
    @Body() input: UpdateWarehouseRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.warehouses.update({ shopId }, id, input, actor);
  }

  @Get('stocks')
  listStocks(
    @Param('shopId', uuid) shopId: string,
    @Query() query: StockQuery,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.list({ shopId }, query, actor);
  }

  @Post('stocks/receive')
  receive(
    @Param('shopId', uuid) shopId: string,
    @Body() input: ReceiveStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.receive({ shopId }, input, actor);
  }

  @Post('stocks/adjust')
  adjust(
    @Param('shopId', uuid) shopId: string,
    @Body() input: AdjustStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.adjust({ shopId }, input, actor);
  }

  @Post('stocks/transfer')
  transfer(
    @Param('shopId', uuid) shopId: string,
    @Body() input: TransferStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.transfer({ shopId }, input, actor);
  }

  @Get('movements')
  movements(
    @Param('shopId', uuid) shopId: string,
    @Query() query: StockQuery,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.movements({ shopId }, query, actor);
  }
}
