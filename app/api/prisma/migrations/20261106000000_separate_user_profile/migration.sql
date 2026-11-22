-- Copy every existing profile before removing the avatar column from User.
-- ALTER TABLE preserves the existing User table and all references to it.
BEGIN IMMEDIATE;

CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "UserProfile" ("userId", "avatarUrl", "createdAt", "updatedAt")
SELECT "id", "avatarUrl", "createdAt", "updatedAt" FROM "User";

ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "User" DROP COLUMN "avatarUrl";

COMMIT;
