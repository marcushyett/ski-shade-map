-- Add statusHash column for consistent deduplication
-- The hash is computed in Node.js using MD5(JSON.stringify(statusInfo))
-- This ensures consistent hashing between insert and comparison (unlike computing hash in PostgreSQL from JSONB)
ALTER TABLE "ResortStatusAnalytics" ADD COLUMN "statusHash" TEXT;

-- Backfill existing records with hashes computed from JSONB
-- Note: New records will have hashes computed in Node.js, which may differ slightly from PostgreSQL's JSON serialization
-- This is acceptable because we only compare hashes from the same source (Node.js computed hashes)
-- Existing records without Node.js hashes will be considered "changed" on next collection, which is fine for initial migration
