import { registerAs } from '@nestjs/config';

function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

export default registerAs('inventory', () => ({
  /** How long an unconfirmed stock hold lasts. */
  reservationTtlSeconds: integer('INVENTORY_RESERVATION_TTL_SECONDS', 900, 60, 86_400),
  /** How often the worker looks for holds past their TTL. */
  expirySweepMs: integer('INVENTORY_EXPIRY_SWEEP_MS', 30_000, 1_000, 3_600_000),
}));
