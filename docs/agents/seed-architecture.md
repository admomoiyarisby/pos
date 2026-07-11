# Seed architecture (resolved by wayfinder #35)

There are **two** independent seed paths in this repo. Neither is named
`db:seed` (no such npm script exists). They read from different sources and
populate overlapping-but-different tables.

## Path A — `vp run migrate-csv` → `tsx scripts/migrate-csv/index.ts`

- **Source:** the 7 CSVs in `docs/csv/` (the frozen "primary reference").
- **Migrations (declared order in `index.ts`):**
  1. `branches` — `branches` (TRUNCATE CASCADE)
  2. `ingredients-central` — `ingredients` (TRUNCATE CASCADE)
  3. `ingredients-tenant` — adds tenant items to `ingredients`
  4. `recipes-rincian` — `recipes` + `recipe_ingredients` (BOMs) (TRUNCATE CASCADE)
  5. `menu-kasir` — updates recipe `basePrice`/`totalCogs` from cashier prices
  6. `staff-menu` — staff recipes
  7. `harga-invoice` — per-branch markup
- **Mechanism:** TRUNCATE + INSERT (idempotent only because it re-runs from
  scratch; `--only <name>` and `--dry-run` supported).
- **Does NOT touch:** users, modifiers / modifier_groups, orders,
  channel_revenues, platform_fees, inventory, vouchers, etc. It is a focused
  master-menu import.
- **Hazard:** `recipes-rincian` TRUNCATEs `recipes` CASCADE, which cascade-
  deletes `recipe_modifier_groups` (FK onDelete cascade). So running Path A
  after Path B wipes the recipe↔modifier _links_ while leaving the
  `modifiers`/`modifier_groups` rows dangling.

## Path B — `vp run seed-full` (and dev HTTP) → `seedAll()` in `src/lib/seed/seed.ts`

- **Entry points:**
  - `scripts/seed-full.ts` (`vp run seed-full`) → `seedDatabase()` in
    `src/routes/api/seed-data.ts`.
  - `POST /api/setup` and `POST /api/seed-data` (dev server, `assertDevOnly`).
- **Source:** `src/lib/seed/seed-data.ts` (the large TS fixture).
- **Populates everything** that Path A skips: users (via `auth.api`),
  modifier_groups + modifiers + modifier_ingredients, recipes + BOMs +
  recipe_modifier_groups, platform_fees, vouchers, inventory, orders,
  channel_revenues, yield conversions, and ~20 more tables. `seedAll()` order
  is in `seed.ts` lines ~1515–1616.
- **Mechanism:** idempotent upsert-by-code (`findExisting` → insert if
  missing). Dev-only.
- **Header note "no longer the live source of truth" is STALE:** empirically
  Path B is the only thing that seeds users / modifiers / orders /
  channel_revenues. It is very much alive.
- **Hazard:** `seed-data.ts` RECIPES_DATA / INGREDIENTS currently do NOT
  contain the ShopeeFood drinks or Chicken Katsu Don. So a `seed-full` reset
  would not produce them — the opposite menu from Path A once the
  `menu-shopeefood` delta is added to Path A only.

## Decision for the wayfinder map

The `menu-shopeefood` delta (drinks, Chicken Katsu Don, shared Tambahan
modifier group) must be reconciled against **both** paths, or we must declare
one canonical and make the other explicitly a no-longer-authoritative
bootstrap:

- If Path A (`migrate-csv`) is the canonical post-merge source, then Path B
  (`seed-data.ts` / `seed-full`) must be updated to include the same drinks +
  modifier group, otherwise `vp run seed-full` silently omits them.
- The shared "Tambahan" modifier group also needs a home: Path A currently has
  **no modifier migration at all** (modifiers come only from Path B). So a
  `menu-shopeefood` step under `migrate-csv/` must either also seed the
  modifier group, or the design must accept that modifiers live in Path B and
  the new module only wires `recipe_modifier_groups` links (which Path A's
  TRUNCATE would then wipe — see hazard above).

See ticket **#44** (reconcile seed-data.ts with the CSV menu / pick canonical
path) and **#39** (design menu-shopeefood module) for the resolution.

## Final wiring (resolved by #41 / #42 / #43)

Canonical = Path A (`migrate-csv`), decided in #44. As-built run order:

**Path A — `vp run migrate-csv`** (menu, canonical):

1. branches → 2. ingredients-central → 3. ingredients-tenant →
2. recipes-rincian → 5. menu-kasir → 6. staff-menu → 7. harga-invoice →
3. **menu-shopeefood** (6 ShopeeFood items + Tambahan modifier group, #41) →
4. **channel-accounting** (seeds `platform_fees`; loads Mulyorejo Excel revenue
   IF a user already exists, else skips revenue with a warning, #42).

**Path B — `vp run seed-full`** (dev demo: users, modifiers, orders, …):

- Runs `seedDatabase()` (creates users + demo data, incl. the 6 items +
  Tambahan mirror added to `seed-data.ts` in #41), THEN calls
  `migrateChannelAccounting()` at its tail so the real Mulyorejo June-2026 Excel
  revenue loads now that users exist. (Wired in `scripts/seed-full.ts`, #43.)

**Recommended full local reset:** `vp run migrate-csv` then `vp run seed-full`.

- migrate-csv builds the canonical menu + `platform_fees`.
- seed-full adds users/modifiers/orders and loads the Excel channel revenue.
- Both are idempotent; channel-accounting upserts ON CONFLICT DO NOTHING.

Key ordering fact: `channel_revenues.submitted_by` is NOT NULL → users.id, so
channel-accounting's _revenue_ rows require a user. `platform_fees` have no such
dependency and seed on any run.
