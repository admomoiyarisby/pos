-- Add better-auth >=1.7 `issuer` column to the account table.
-- Hand-written migration, applied manually like drizzle/0028-0031 (not journaled).
--
-- better-auth v1.7 stores a synthetic issuer on every account row and matches
-- credential accounts on providerId + issuer ("local:credential") + accountId
-- during signInEmail. Tables created before that column existed have no issuer,
-- so the lookup never matches and EVERY email/password login fails with
-- "Invalid email or password" (better-auth logs "User not found").
--
-- Backfill: existing credential rows are local email/password accounts, so they
-- get the local credential issuer. Non-credential (OAuth) rows, if any, get the
-- OAuth issuer namespace; adjust if you use a custom OAuth provider with an
-- explicit issuer.

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "provider_id" = 'credential' AND "issuer" IS NULL;

UPDATE "account"
SET "issuer" = 'local:oauth:' || "provider_id"
WHERE "provider_id" <> 'credential' AND "issuer" IS NULL;
