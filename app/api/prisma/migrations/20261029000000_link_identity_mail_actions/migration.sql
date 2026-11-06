ALTER TABLE "IdentityMail" ADD COLUMN "actionId" TEXT
REFERENCES "AccountAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "IdentityMail_actionId_idx" ON "IdentityMail"("actionId");

-- Old pending messages cannot be safely matched to a particular token issuance.
-- Retire them rather than delivering a superseded or already-consumed token.
-- Sent mail history is left unchanged.
UPDATE "IdentityMail"
SET "text" = '',
    "expiresAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    "lockedUntil" = NULL,
    "lastError" = 'ACCOUNT_ACTION_UNAVAILABLE'
WHERE "sentAt" IS NULL AND "actionId" IS NULL;
