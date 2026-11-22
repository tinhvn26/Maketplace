-- Disable foreign keys before opening the transaction so rebuilding User cannot
-- cascade into profiles, credentials or shops. Rename the replacement table only
-- after copying every field; never rename the referenced original table.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "emailVerifiedAt" DATETIME,
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

INSERT INTO "new_User" (
    "id", "fullName", "emailNormalized", "passwordHash", "phoneNumber",
    "status", "role", "emailVerifiedAt", "authVersion", "createdAt",
    "updatedAt", "deletedAt"
)
SELECT
    "id", "fullName", "emailNormalized", "passwordHash", "phoneNumber",
    "status", CASE WHEN "role" = 'USER' THEN 'CUSTOMER' ELSE "role" END,
    "emailVerifiedAt", "authVersion", "createdAt", "updatedAt", "deletedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "User_role_status_deletedAt_idx" ON "User"("role", "status", "deletedAt");

COMMIT;
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
