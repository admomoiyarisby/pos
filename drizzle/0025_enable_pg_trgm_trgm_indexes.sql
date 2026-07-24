-- ADR-0008: enable pg_trgm for typo-tolerant (trigram) fuzzy search on the
-- server-side free-text search helpers (see src/lib/server/fuzzy.ts).
-- Without this extension, similarity() used by fuzzySearch() errors at runtime.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes keep similarity() fast on the large searched tables.
-- (Smaller tables — brands, vouchers, modifier_groups — use a seq scan, which
-- is fine at their size.)
CREATE INDEX IF NOT EXISTS idx_ingredients_name_trgm ON ingredients USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_recipes_name_trgm ON recipes USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_branches_code_trgm ON branches USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_branches_name_trgm ON branches USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_branches_location_trgm ON branches USING gin (location gin_trgm_ops);
