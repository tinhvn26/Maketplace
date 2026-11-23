import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { InventoryAvailabilityService } from '../../../application/availability/inventory-availability.service.js';
import { AvailabilityQuery } from '../dto/inventory.requests.js';
import { InventoryExceptionFilter } from '../filters/inventory-exception.filter.js';

/** Public in/out-of-stock signal; never exposes quantities. */
@Controller('inventory')
@UseFilters(InventoryExceptionFilter)
export class InventoryAvailabilityController {
  constructor(private readonly availability: InventoryAvailabilityService) {}

  @Get('availability')
  check(@Query() query: AvailabilityQuery) {
    return this.availability.check(query.variantIds);
  }
}
