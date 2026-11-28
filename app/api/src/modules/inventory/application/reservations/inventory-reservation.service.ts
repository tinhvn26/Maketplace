import { createHash } from 'node:crypto';
import type { CatalogPricing } from '../../../catalog/contracts/catalog-pricing.api.js';
import type { InventoryReservations } from '../../contracts/inventory.api.js';
import type {
  ReservationResult,
  ReserveStockRequest,
} from '../../contracts/inventory.types.js';
import {
  confirmReservation,
  createReservation,
  expireReservation,
  isReservationExpired,
  releaseReservation,
  shipReservationWarehouse,
} from '../../domain/entities/reservation.js';
import type {
  Reservation,
  ReservationLine,
} from '../../domain/entities/reservation.js';
import {
  releaseStock,
  reserveStock,
  shipStock,
} from '../../domain/entities/stock.js';
import { stockMovement } from '../../domain/entities/stock-movement.js';
import type { StockMovementType } from '../../domain/entities/stock-movement.js';
import {
  IdempotencyConflictError,
  InventoryNotFoundError,
  InventoryConflictError,
  InventoryValidationError,
  ReservationStateError,
} from '../../domain/errors/inventory.errors.js';
import {
  inventoryId,
  positiveQuantity,
} from '../../domain/policies/inventory-input.policy.js';
import { allocateStock } from '../../domain/policies/stock-allocation.policy.js';
import type {
  InventoryClock,
  InventoryIdGenerator,
} from '../ports/inventory-runtime.js';
import type {
  InventoryRepositories,
  InventoryUnitOfWork,
} from '../ports/inventory-unit-of-work.js';
import { retryOnConflict } from '../shared/inventory-retry.js';

const MAX_LINES = 100;
const MAX_LINE_QUANTITY = 999;

export class InventoryReservationService implements InventoryReservations {
  constructor(
    private readonly unitOfWork: InventoryUnitOfWork,
    private readonly pricing: CatalogPricing,
    private readonly options: { ttlSeconds: number },
    private readonly ids: InventoryIdGenerator,
    private readonly clock: InventoryClock,
  ) {}

  async reserve(request: ReserveStockRequest): Promise<ReservationResult> {
    const input = this.validate(request);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({ reference: input.reference, lines: input.lines }),
      )
      .digest('hex');

    // A replay is answered before pricing so it survives the variant being retired later.
    const existing = await this.unitOfWork.read((tx) =>
      tx.reservations.findByIdempotencyKey(input.idempotencyKey),
    );
    if (existing) return this.replay(existing, requestHash);

    // Rejects variants that are unpublished, inactive, or whose shop cannot sell.
    // Known gap: the quote runs before the transaction, so a variant retired in
    // between can still be held. The hold expires by TTL, and Orders must quote
    // again at confirm time before taking payment.
    await this.pricing.quote({ lines: input.lines });

    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        const duplicate = await tx.reservations.findByIdempotencyKey(
          input.idempotencyKey,
        );
        if (duplicate) return this.replay(duplicate, requestHash);

        const now = this.clock.now();
        const candidates = await tx.stocks.findCandidates(
          input.lines.map((line) => line.variantId),
        );
        const allocations = allocateStock(input.lines, candidates);
        const stocks = new Map(
          candidates.map((candidate) => [candidate.stockId, candidate.stock]),
        );
        const movements = [];
        for (const allocation of allocations) {
          const current = stocks.get(allocation.stockId)!;
          await tx.stocks.save(
            reserveStock(current, allocation.quantity, now),
            current.version,
          );
          movements.push(
            stockMovement({
              stockId: allocation.stockId,
              type: 'RESERVE',
              onHandDelta: 0,
              reservedDelta: allocation.quantity,
              reason: `Reserved for ${input.reference}`,
              createdAt: now,
            }),
          );
        }
        const reservation = createReservation({
          id: this.ids.next(),
          idempotencyKey: input.idempotencyKey,
          requestHash,
          reference: input.reference,
          expiresAt: new Date(now.getTime() + this.options.ttlSeconds * 1000),
          lines: allocations.map((allocation) => ({
            ...allocation,
            shippedAt: null,
          })),
          now,
        });
        await tx.reservations.insert(reservation);
        await tx.stocks.appendMovements(
          movements.map((movement) => ({
            ...movement,
            reservationId: reservation.id,
          })),
        );
        return this.toResult(reservation);
      }),
    );
  }

  async get(reservationId: string): Promise<ReservationResult> {
    const id = inventoryId(reservationId, 'reservation identifier');
    return this.unitOfWork.read(async (tx) =>
      this.toResult(await this.load(tx, id)),
    );
  }

  confirm(reservationId: string): Promise<ReservationResult> {
    const id = inventoryId(reservationId, 'reservation identifier');
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        const current = await this.load(tx, id);
        const next = confirmReservation(current, this.clock.now());
        if (next === current) return this.toResult(current);
        return this.toResult(await tx.reservations.save(next, current.version));
      }),
    );
  }

  release(
    reservationId: string,
    options: { refuseIfShipped?: boolean } = {},
  ): Promise<ReservationResult> {
    const id = inventoryId(reservationId, 'reservation identifier');
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        const current = await this.load(tx, id);
        // Checked in the same transaction as the release, so a concurrent ship cannot slip in between.
        if (
          options.refuseIfShipped &&
          current.lines.some((line) => line.shippedAt !== null)
        )
          throw new ReservationStateError(
            'Part of the reservation has already shipped',
          );
        const now = this.clock.now();
        const { reservation, released } = releaseReservation(current, now);
        if (reservation === current) return this.toResult(current);
        await this.giveBack(
          tx,
          released,
          'RELEASE',
          current.id,
          'Reservation released',
          now,
        );
        return this.toResult(
          await tx.reservations.save(reservation, current.version),
        );
      }),
    );
  }

  ship(reservationId: string, warehouseId: string): Promise<ReservationResult> {
    const id = inventoryId(reservationId, 'reservation identifier');
    const warehouse = inventoryId(warehouseId, 'warehouse identifier');
    return retryOnConflict(() =>
      this.unitOfWork.run(async (tx) => {
        const current = await this.load(tx, id);
        const now = this.clock.now();
        const { reservation, shipped } = shipReservationWarehouse(
          current,
          warehouse,
          now,
        );
        const stocks = await this.loadStocks(tx, shipped);
        const movements = [];
        for (const line of shipped) {
          const stock = stocks.get(line.stockId)!;
          await tx.stocks.save(
            shipStock(stock, line.quantity, now),
            stock.version,
          );
          movements.push(
            stockMovement({
              stockId: line.stockId,
              type: 'SHIP',
              onHandDelta: -line.quantity,
              reservedDelta: -line.quantity,
              reason: `Shipped for ${current.reference}`,
              reservationId: current.id,
              createdAt: now,
            }),
          );
        }
        await tx.stocks.appendMovements(movements);
        return this.toResult(
          await tx.reservations.save(reservation, current.version),
        );
      }),
    );
  }

  async expireDue(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new InventoryValidationError('Limit must be from 1 to 1000');
    const ids = await this.unitOfWork.read((tx) =>
      tx.reservations.findExpiredIds(this.clock.now(), limit),
    );
    let expired = 0;
    for (const id of ids) {
      try {
        const done = await retryOnConflict(() =>
          this.unitOfWork.run(async (tx) => {
            const current = await tx.reservations.findById(id);
            const now = this.clock.now();
            // Confirmed or released meanwhile: nothing left to expire.
            if (!current || !isReservationExpired(current, now)) return false;
            const { reservation, released } = expireReservation(current, now);
            await this.giveBack(
              tx,
              released,
              'EXPIRE',
              current.id,
              'Reservation expired',
              now,
            );
            await tx.reservations.save(reservation, current.version);
            return true;
          }),
        );
        if (done) expired++;
      } catch (error) {
        // One busy reservation must not stop the sweep; it is retried on the next run.
        if (!(error instanceof InventoryConflictError)) throw error;
      }
    }
    return expired;
  }

  private validate(request: ReserveStockRequest) {
    if (typeof request !== 'object' || request === null)
      throw new InventoryValidationError('A reservation request is required');
    const idempotencyKey = inventoryId(
      request.idempotencyKey,
      'idempotency key',
    );
    const reference = inventoryId(request.reference, 'reference');
    if (
      !Array.isArray(request.lines) ||
      request.lines.length < 1 ||
      request.lines.length > MAX_LINES
    )
      throw new InventoryValidationError(
        `Reservation requires 1 to ${MAX_LINES} unique variants`,
      );
    const seen = new Set<string>();
    const lines = request.lines.map((line) => {
      const variantId = inventoryId(line?.variantId, 'variant identifier');
      if (seen.has(variantId))
        throw new InventoryValidationError('Duplicate variant in reservation');
      seen.add(variantId);
      return {
        variantId,
        quantity: positiveQuantity(line.quantity, MAX_LINE_QUANTITY),
      };
    });
    // Sorted so the same request hashes identically regardless of line order.
    lines.sort((a, b) => a.variantId.localeCompare(b.variantId));
    return { idempotencyKey, reference, lines };
  }

  private replay(
    existing: Reservation,
    requestHash: string,
  ): ReservationResult {
    if (existing.requestHash !== requestHash)
      throw new IdempotencyConflictError();
    return this.toResult(existing);
  }

  private async load(
    tx: InventoryRepositories,
    id: string,
  ): Promise<Reservation> {
    const reservation = await tx.reservations.findById(id);
    if (!reservation) throw new InventoryNotFoundError('Reservation not found');
    return reservation;
  }

  private async loadStocks(
    tx: InventoryRepositories,
    lines: readonly ReservationLine[],
  ) {
    const stocks = await tx.stocks.findByIds(lines.map((line) => line.stockId));
    return new Map(stocks.map((stock) => [stock.id, stock]));
  }

  /** Returns held units to stock and records why. */
  private async giveBack(
    tx: InventoryRepositories,
    lines: readonly ReservationLine[],
    type: Extract<StockMovementType, 'RELEASE' | 'EXPIRE'>,
    reservationId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    const stocks = await this.loadStocks(tx, lines);
    const movements = [];
    for (const line of lines) {
      const stock = stocks.get(line.stockId)!;
      await tx.stocks.save(
        releaseStock(stock, line.quantity, now),
        stock.version,
      );
      movements.push(
        stockMovement({
          stockId: line.stockId,
          type,
          onHandDelta: 0,
          reservedDelta: -line.quantity,
          reason,
          reservationId,
          createdAt: now,
        }),
      );
    }
    await tx.stocks.appendMovements(movements);
  }

  private toResult(reservation: Reservation): ReservationResult {
    return {
      reservationId: reservation.id,
      reference: reservation.reference,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      allocations: reservation.lines.map((line) => ({
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        quantity: line.quantity,
        shipped: line.shippedAt !== null,
      })),
    };
  }
}
