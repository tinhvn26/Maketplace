import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

type Connection = Awaited<ReturnType<PrismaBetterSqlite3['connect']>>;
const migrationName = '20261106010000_user_roles_customer_employer';
const relatedTables = [
  'UserProfile',
  'AuthSession',
  'AccountAction',
  'IdentityMail',
  'Shop',
  'CatalogCategory',
  'CatalogProduct',
  'CatalogVariant',
  'CatalogReview',
  'CatalogAudit',
  'MediaAsset',
  'MediaUsage',
];

async function rows(connection: Connection, sql: string) {
  const result = await connection.queryRaw({ sql, args: [], argTypes: [] });
  return result.rows.map((row) =>
    Object.fromEntries(
      result.columnNames.map((column, index) => [column, row[index]]),
    ),
  );
}

async function snapshot(connection: Connection) {
  return Object.fromEntries(
    await Promise.all(
      relatedTables.map(async (table) => [
        table,
        await rows(connection, `SELECT * FROM "${table}" ORDER BY rowid`),
      ]),
    ),
  );
}

describe('User roles migration with a nonempty SQLite database', () => {
  let directory: string;
  let connection: Connection;
  let legacyMigrations: string[];
  let migrationSql: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-user-roles-'));
    const migrationDirectory = new URL(
      '../prisma/migrations/',
      import.meta.url,
    );
    const names = (await readdir(migrationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    legacyMigrations = await Promise.all(
      names
        .filter((name) => name < migrationName)
        .map((name) =>
          readFile(
            new URL(`${name}/migration.sql`, migrationDirectory),
            'utf8',
          ),
        ),
    );
    migrationSql = await readFile(
      new URL(`${migrationName}/migration.sql`, migrationDirectory),
      'utf8',
    );
  });

  beforeEach(async () => {
    connection = await new PrismaBetterSqlite3({
      url: `file:${join(directory, `${randomUUID()}.db`).replaceAll('\\', '/')}`,
    }).connect();
    for (const sql of legacyMigrations) await connection.executeScript(sql);
    await connection.executeScript(`
      PRAGMA foreign_keys = ON;
      INSERT INTO "User" ("id", "fullName", "emailNormalized", "passwordHash", "phoneNumber", "status", "role", "emailVerifiedAt", "authVersion", "createdAt", "updatedAt", "deletedAt")
      VALUES
        ('legacy-user', 'Legacy Customer', 'legacy@example.com', 'legacy-password-hash', '+84901234567', 'ACTIVE', 'USER', '2020-01-02T03:04:05.000Z', 7, '2019-01-02T03:04:05.000Z', '2021-01-02T03:04:05.000Z', NULL),
        ('administrator', 'Administrator', 'admin@example.com', 'admin-password-hash', NULL, 'ACTIVE', 'ADMIN', NULL, 3, '2019-01-02T03:04:05.000Z', '2021-01-02T03:04:05.000Z', NULL),
        ('employer', 'Existing Employer', 'employer@example.com', 'employer-password-hash', '+84912345678', 'ACTIVE', 'EMPLOYER', NULL, 2, '2019-01-02T03:04:05.000Z', '2021-01-02T03:04:05.000Z', NULL),
        ('customer', 'Existing Customer', 'customer@example.com', 'customer-password-hash', NULL, 'LOCKED', 'CUSTOMER', NULL, 4, '2019-01-02T03:04:05.000Z', '2021-01-02T03:04:05.000Z', '2022-01-02T03:04:05.000Z');
      INSERT INTO "UserProfile" ("userId", "avatarUrl", "createdAt", "updatedAt")
      SELECT "id", 'https://example.com/' || "id" || '.png', "createdAt", "updatedAt" FROM "User";
      INSERT INTO "AuthSession" ("id", "userId", "authVersion", "refreshTokenHash", "expiresAt", "createdAt", "lastUsedAt")
      SELECT 'session-' || "id", "id", "authVersion", 'refresh-' || "id", '2100-01-01T00:00:00.000Z', "createdAt", "updatedAt" FROM "User";
      INSERT INTO "AccountAction" ("id", "userId", "purpose", "tokenHash", "attempts", "emailNormalized", "authVersion", "expiresAt", "createdAt")
      SELECT 'action-' || "id", "id", 'RESET_PASSWORD', 'otp-hash-' || "id", 2, "emailNormalized", "authVersion", '2100-01-01T00:00:00.000Z', "updatedAt" FROM "User";
      INSERT INTO "IdentityMail" ("id", "actionId", "to", "subject", "text", "createdAt", "availableAt", "expiresAt", "attempts", "lockedUntil", "lastError")
      SELECT 'mail-' || "id", 'action-' || "id", "emailNormalized", 'Reset password', 'OTP mail body', "updatedAt", "updatedAt", '2100-01-01T00:00:00.000Z', 1, '2100-01-01T00:00:00.000Z', 'SMTP_NETWORK' FROM "User";
      INSERT INTO "Shop" ("id", "name", "slug", "ownerId", "status", "version", "createdAt", "updatedAt")
      VALUES ('shop', 'Existing Shop', 'existing-shop', 'legacy-user', 'ACTIVE', 9, '2020-01-02T03:04:05.000Z', '2021-01-02T03:04:05.000Z');
      INSERT INTO "CatalogCategory" ("id", "name", "slug") VALUES ('category', 'Category', 'category');
      INSERT INTO "CatalogProduct" ("id", "categoryId", "shopId", "name", "slug", "updatedAt")
      VALUES ('product', 'category', 'shop', 'Product', 'product', '2021-01-02T03:04:05.000Z');
      INSERT INTO "CatalogVariant" ("id", "productId", "sku", "name", "priceAmount")
      VALUES ('variant', 'product', 'MIGRATION-SKU', 'Variant', 1000);
      INSERT INTO "CatalogReview" ("id", "productId", "baseVersion", "snapshot", "submittedBy", "updatedAt")
      VALUES ('review', 'product', 0, '{}', 'legacy-user', '2021-01-02T03:04:05.000Z');
      INSERT INTO "CatalogAudit" ("id", "actorId", "action", "entityType", "entityId", "shopId")
      VALUES ('audit', 'employer', 'PRODUCT_CREATE', 'PRODUCT', 'product', 'shop');
      INSERT INTO "MediaAsset" ("id", "shopId", "ownerId", "storageKey", "mimeType", "byteSize", "width", "height")
      VALUES ('asset', 'shop', 'legacy-user', 'migration-image', 'image/webp', 100, 10, 10);
      INSERT INTO "MediaUsage" ("assetId", "kind", "resourceId") VALUES ('asset', 'CATALOG_PRODUCT', 'product');
    `);
  });

  afterEach(async () => {
    await connection?.dispose();
  });

  afterAll(async () => {
    if (!directory) return;
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !target.includes('marketplate-user-roles-')
    ) {
      throw new Error(
        'Refusing to remove a directory outside the test workspace',
      );
    }
    await rm(target, { recursive: true, force: true });
  });

  it('renames only USER and preserves every account field and related row without revoking credentials', async () => {
    expect(await rows(connection, 'PRAGMA foreign_keys')).toEqual([
      { foreign_keys: 1 },
    ]);
    const users = await rows(connection, 'SELECT * FROM "User" ORDER BY "id"');
    const related = await snapshot(connection);
    for (const table of relatedTables)
      expect(related[table]).not.toHaveLength(0);
    await connection.executeScript(migrationSql);
    expect(
      await rows(connection, 'SELECT * FROM "User" ORDER BY "id"'),
    ).toEqual(
      users.map((user) => ({
        ...user,
        role: user.role === 'USER' ? 'CUSTOMER' : user.role,
      })),
    );
    expect(await snapshot(connection)).toEqual(related);
    expect(await rows(connection, 'PRAGMA foreign_keys')).toEqual([
      { foreign_keys: 1 },
    ]);
    expect(await rows(connection, 'PRAGMA foreign_key_check')).toEqual([]);
    const indexes = await rows(connection, 'PRAGMA index_list("User")');
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'User_emailNormalized_key',
        'User_deletedAt_idx',
        'User_role_status_deletedAt_idx',
      ]),
    );
  });

  it('defaults new accounts to CUSTOMER and keeps uniqueness and foreign-key enforcement active', async () => {
    await connection.executeScript(migrationSql);
    await connection.executeScript(`
      INSERT INTO "User" ("id", "fullName", "emailNormalized", "passwordHash", "updatedAt")
      VALUES ('default-role', 'Default Customer', 'default@example.com', 'hash', CURRENT_TIMESTAMP);
    `);
    expect(
      await rows(
        connection,
        'SELECT "role", "status", "authVersion", "phoneNumber" FROM "User" WHERE "id" = \'default-role\'',
      ),
    ).toEqual([
      {
        role: 'CUSTOMER',
        status: 'ACTIVE',
        authVersion: 0,
        phoneNumber: null,
      },
    ]);
    await expect(async () => {
      await connection.executeScript(`
      INSERT INTO "User" ("id", "fullName", "emailNormalized", "passwordHash", "updatedAt")
      VALUES ('duplicate-email', 'Duplicate', 'default@example.com', 'hash', CURRENT_TIMESTAMP);
    `);
    }).rejects.toThrow();
    await expect(async () => {
      await connection.executeScript(
        `DELETE FROM "User" WHERE "id" = 'legacy-user';`,
      );
    }).rejects.toThrow();
    await expect(async () => {
      await connection.executeScript(`
      INSERT INTO "UserProfile" ("userId", "updatedAt") VALUES ('missing-user', CURRENT_TIMESTAMP);
    `);
    }).rejects.toThrow();
    expect(await rows(connection, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('rolls back the table rebuild and data translation if a legacy view blocks the replacement rename', async () => {
    const users = await rows(connection, 'SELECT * FROM "User" ORDER BY "id"');
    const related = await snapshot(connection);
    await connection.executeScript(
      'CREATE VIEW "LegacyUserView" AS SELECT id, role FROM "User";',
    );
    await expect(async () => {
      await connection.executeScript(migrationSql);
    }).rejects.toThrow();
    await connection.executeScript('ROLLBACK; PRAGMA foreign_keys = ON;');
    expect(
      await rows(connection, 'SELECT * FROM "User" ORDER BY "id"'),
    ).toEqual(users);
    expect(await snapshot(connection)).toEqual(related);
    expect(
      await rows(
        connection,
        'SELECT role FROM "LegacyUserView" WHERE id = \'legacy-user\'',
      ),
    ).toEqual([{ role: 'USER' }]);
    expect(
      await rows(
        connection,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'new_User'",
      ),
    ).toEqual([]);
    expect(await rows(connection, 'PRAGMA foreign_keys')).toEqual([
      { foreign_keys: 1 },
    ]);
    expect(await rows(connection, 'PRAGMA foreign_key_check')).toEqual([]);
  });
});
