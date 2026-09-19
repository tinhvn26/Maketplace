import { Controller } from "@nestjs/common";
import { InventoryService } from "./inventory.service.js";

@Controller('inventory')
export class InventoryController {
    constructor(private readonly inventoryService: InventoryService) {}
    
}