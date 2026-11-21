export interface CatalogClock {
  now(): Date;
}

export interface CatalogIdGenerator {
  next(): string;
}
