-- ID17: Add production_date to yield_conversions for Central Kitchen batch entry
ALTER TABLE "yield_conversions" ADD COLUMN IF NOT EXISTS "production_date" TIMESTAMP NOT NULL DEFAULT NOW();
