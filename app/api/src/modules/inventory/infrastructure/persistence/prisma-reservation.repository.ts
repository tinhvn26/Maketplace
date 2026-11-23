import type {
  InventoryReservation as PrismaReservation,
  InventoryReservationLine as PrismaLine,
  Prisma,
} from '../../../../platform/database/generated/client.js';
import type { ReservationRepository } from '../../application/ports/reservation.repository.js';
import type {
  Reservation,
  ReservationStatus,
} from '../../domain/entities/reservation.js';
import { InventoryVersionConflictError } from '../../domain/errors/inventory.errors.js';
import { translateStorageError } from './prisma-errors.js';
import type { InventoryDatabase } from './prisma-warehouse.repository.js';

const STATUSES: readonly string[] = [
  'ACTIVE',
  'ALLOCATED',
  'SHIPPED',
  'RELEASED',
  'EXPIRED',
] satisfies ReservationStatus[];

type ReservationRow = PrismaReservation & { lines: PrismaLine[] };

const withLines = {
  // position keeps allocation order, so a replayed request answers exactly like the first one.
  lines: { orderBy: { position: 'asc' } },
} satisfies Prisma.InventoryReservationInclude;

export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly db: InventoryDatabase) {}

  async findById(id: string) {
    const row = await this.db.inventoryReservation.findUnique({
      where: { id },
      include: withLines,
    });
    return row ? this.toReservation(row) : null;
  }

  async findByIdempotencyKey(key: string) {
    const row = await this.db.inventoryReservation.findUnique({
      where: { idempotencyKey: key },
      include: withLines,
    });
    return row ? this.toReservation(row) : null;
  }

  async insert(reservation: Reservation): Promise<void> {
    const { lines, ...header } = reservation;
    try {
      await this.db.inventoryReservation.create({
        data: { ...header, lines: { create: lines.map((line, position) => ({ ...line, position })) } },
      });
    } catch (error) {
      // A duplicate key means another request won the race: the caller re-reads and replays it.
      translateStorageError(error);
    }
  }

  async save(reservation: Reservation, expectedVersion: number) {
    const updated = await this.db.inventoryReservation.updateMany({
      where: { id: reservation.id, version: expectedVersion },
      data: {
        status: reservation.status,
        expiresAt: reservation.expiresAt,
        updatedAt: reservation.updatedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new InventoryVersionConflictError();
    for (const line of reservation.lines) {
      if (line.shippedAt === null) continue;
      await this.db.inventoryReservationLine.updateMany({
        where: {
          reservationId: reservation.id,
          stockId: line.stockId,
          shippedAt: null,
        },
        data: { shippedAt: line.shippedAt },
      });
    }
    return this.toReservation(
      await this.db.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
        include: withLines,
      }),
    );
  }

  async findExpiredIds(now: Date, limit: number) {
    const rows = await this.db.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private toReservation({ lines, status, ...row }: ReservationRow): Reservation {
    if (!STATUSES.includes(status))
      throw new Error('Unsupported persisted reservation status');
    return {
      ...row,
      status: status as ReservationStatus,
      lines: lines.map(({ id: _id, reservationId: _reservationId, position: _position, ...line }) => line),
    };
  }
}
