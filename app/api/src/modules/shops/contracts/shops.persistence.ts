// For other modules' persistence adapters that must check a shop inside their
// own write transaction or filter by sellable shops in SQL. Never import this
// from domain/application.
export {
  findShopState,
  sellableShopIdsSql,
  sellableShopWhere,
} from '../infrastructure/persistence/shop.persistence.js';
