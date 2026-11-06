ALTER TABLE "AccountAction" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Outstanding reset links cannot be used by the email-and-code flow.
UPDATE "AccountAction"
SET "consumedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE "purpose" = 'RESET_PASSWORD' AND "consumedAt" IS NULL;

-- Do not deliver obsolete reset links or empty messages after the upgrade.
UPDATE "IdentityMail"
SET "text" = '', "expiresAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE "subject" = 'Reset your Marketplate password' AND "sentAt" IS NULL;
