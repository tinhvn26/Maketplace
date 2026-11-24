export type StockMovementType =
  | 'RECEIPT'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'RESERVE'
  | 'RELEASE'
  | 'EXPIRE'
  | 'SHIP';

/** Append-only ledger entry; deltas are the change applied to one stock row. */
export interface StockMovement {
  stockId: string;
  type: StockMovementType;
  onHandDelta: number;
  reservedDelta: number;
  reason: string;
  actorUserId: string | null;
  reservationId: string | null;
  transferId: string | null;
  createdAt: Date;
}

export interface StockMovementRecord extends StockMovement {
  id: string;
  warehouseId: string;
  variantId: string;
}

export function stockMovement(
  input: Pick<
    StockMovement,
    | 'stockId'
    | 'type'
    | 'onHandDelta'
    | 'reservedDelta'
    | 'reason'
    | 'createdAt'
  > &
    Partial<
      Pick<StockMovement, 'actorUserId' | 'reservationId' | 'transferId'>
    >,
): StockMovement {
  return {
    actorUserId: null,
    reservationId: null,
    transferId: null,
    ...input,
  };
}
