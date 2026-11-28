import type { ShopActor } from '../../../shops/contracts/shops.api.js';
import type { Order, OrderStatus } from '../../domain/entities/order.js';

export const ORDER_UNIT_OF_WORK = Symbol('ORDER_UNIT_OF_WORK');

export type OrderActor = ShopActor;

export interface OrderCheckoutRecord {
  id: string;
  buyerId: string;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
}

export interface OrderListQuery {
  buyerId?: string;
  /** Undefined means every shop; null means platform orders. */
  shopId?: string | null;
  status?: OrderStatus;
  page: number;
  limit: number;
}

export interface OrderStore {
  findCheckout(
    buyerId: string,
    idempotencyKey: string,
  ): Promise<{ checkout: OrderCheckoutRecord; orders: Order[] } | null>;
  insertCheckout(checkout: OrderCheckoutRecord, orders: Order[]): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /** Newest first: createdAt desc, then id desc. */
  list(query: OrderListQuery): Promise<{ items: Order[]; total: number }>;
  /** Compare-and-set on version; returns the order with version + 1. */
  save(order: Order, expectedVersion: number): Promise<Order>;
}

export interface OrderAccessReader {
  isActiveAccount(actor: OrderActor): Promise<boolean>;
  findShopState(
    shopId: string,
  ): Promise<{ ownerId: string; sellable: boolean } | null>;
}

export interface OrderRepositories {
  orders: OrderStore;
  access: OrderAccessReader;
}

export interface OrderUnitOfWork {
  /** One write transaction that takes SQLite's write lock first. */
  run<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T>;
  read<T>(work: (tx: OrderRepositories) => Promise<T>): Promise<T>;
}
