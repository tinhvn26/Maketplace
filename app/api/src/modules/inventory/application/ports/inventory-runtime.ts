export interface InventoryClock {
  now(): Date;
}

export interface InventoryIdGenerator {
  next(): string;
}
