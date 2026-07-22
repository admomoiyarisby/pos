# Recipe Categories as a Mutable Table

Recipe categories were originally a Postgres enum (`recipe_category`) with five fixed values (makanan, minuman, snack, add_ons, paket_bundle), mirrored by a static `CATEGORIES` const in `src/lib/server/categories.ts`. Categories are mutable business concepts — new menu groupings arise as the restaurant grows — but Postgres enums resist mutation: `ALTER TYPE ... ADD VALUE` can't run inside a transaction and has no rollback. We decided to replace the enum with a `categories` table and reference it via FK from `recipes`.

## Status

Accepted

## Considered Options

- **Keep enum + hardcoded array** — simple but brittle. Adding a category requires both a DB migration and a code change. Deleting or renaming is painful.
- **`categories` table** — single source of truth, CRUD-able via normal INSERT/UPDATE/DELETE, FK integrity, seedable in migrations. Slightly more complex querying (JOIN vs direct enum value) but worth it for mutability.
- **`text` column with no FK** — flexible but no referential integrity; orphans accumulate.

## Consequences

- Multi-step migration: (1) create `categories` table, seed the 5 existing values; (2) add nullable `categoryId` FK on `recipes`; (3) backfill `categoryId` from the old enum column; (4) make the FK required; (5) drop the old `category` column and the `recipe_category` enum.
- The Zod enum in `assignRecipesToCategory` is replaced by a dynamic query against the `categories` table.
- The UI gains "Tambah Kategori" and "Hapus Kategori" actions, gated to `super_admin` / `admin_pusat`. Deleting a category requires a destination category for orphaned recipes.
