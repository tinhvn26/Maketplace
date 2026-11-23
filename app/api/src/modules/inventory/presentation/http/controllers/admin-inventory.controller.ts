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
import { AdminRoleGuard } from '../../../../identity/contracts/identity.http.js';
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
const platform = { shopId: null };

/** Platform warehouses (not owned by any shop); administrators only. */
@Controller('admin/inventory')
@UseGuards(InventoryAuthenticatedGuard, AdminRoleGuard)
@UseFilters(InventoryExceptionFilter)
export class AdminInventoryController {
  constructor(
    private readonly warehouses: InventoryWarehouseService,
    private readonly stock: InventoryStockService,
  ) {}

  @Post('warehouses')
  createWarehouse(
    @Body() input: CreateWarehouseRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.warehouses.create(platform, input, actor);
  }

  @Get('warehouses')
  listWarehouses(@CurrentInventoryActor() actor: ShopActor) {
    return this.warehouses.list(platform, actor);
  }

  @Patch('warehouses/:id')
  updateWarehouse(
    @Param('id', uuid) id: string,
    @Body() input: UpdateWarehouseRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.warehouses.update(platform, id, input, actor);
  }

  @Get('stocks')
  listStocks(
    @Query() query: StockQuery,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.list(platform, query, actor);
  }

  @Post('stocks/receive')
  receive(
    @Body() input: ReceiveStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.receive(platform, input, actor);
  }

  @Post('stocks/adjust')
  adjust(
    @Body() input: AdjustStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.adjust(platform, input, actor);
  }

  @Post('stocks/transfer')
  transfer(
    @Body() input: TransferStockRequest,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.transfer(platform, input, actor);
  }

  @Get('movements')
  movements(
    @Query() query: StockQuery,
    @CurrentInventoryActor() actor: ShopActor,
  ) {
    return this.stock.movements(platform, query, actor);
  }
}
