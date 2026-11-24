import { Prisma } from '../../../../platform/database/generated/client.js';
import { USER_ROLES } from '../../domain/types/user-role.type.js';
import type { UserRole } from '../../domain/types/user-role.type.js';

type Database = Prisma.TransactionClient;

export interface ActiveAccount {
  id: string;
  role: UserRole;
}

/** An account that may act: active, not deleted, with a known role. */
export const activeAccountWhere = {
  status: 'ACTIVE',
  deletedAt: null,
  role: { in: [...USER_ROLES] },
} satisfies Prisma.UserWhereInput;

/** Same rule as `activeAccountWhere`, for raw SQL: `... IN (${activeAccountIdsSql()})`. */
export function activeAccountIdsSql(): Prisma.Sql {
  return Prisma.sql`SELECT u."id" FROM "User" u WHERE u."status" = 'ACTIVE' AND u."deletedAt" IS NULL AND u."role" IN (${Prisma.join([...USER_ROLES])})`;
}

/** Takes SQLite's write lock through the account row, so role or status
 * changes queue behind the caller's transaction. */
export async function lockAccount(tx: Database, userId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "User" SET "authVersion" = "authVersion" WHERE "id" = ${userId}`;
}

/** The account, if it is active and still holds the role the caller authenticated with. */
export async function findActiveAccount(
  db: Database,
  actor: { userId: string; role: string },
): Promise<ActiveAccount | null> {
  const user = await db.user.findFirst({
    where: { id: actor.userId, ...activeAccountWhere },
    select: { id: true, role: true },
  });
  return user && user.role === actor.role
    ? { id: user.id, role: user.role as UserRole }
    : null;
}
