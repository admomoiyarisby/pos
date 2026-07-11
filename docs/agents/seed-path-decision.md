# Seed-path reconciliation decision (resolved by wayfinder #44)

## Decision

**`vp run migrate-csv` (Path A) is the canonical source of truth for the menu + modifiers.**
`src/lib/seed/seed-data.ts` (Path B) is **demoted to a dev-only demo bootstrap** — it must be updated to _mirror_ the new ShopeeFood delta (6 items + shared Tambahan group) so a `vp run seed-full` dev reset stays coherent, but it is no longer authoritative. The header note "no longer the live source of truth" is corrected/inverted: Path A is the live source; Path B is dev-only demo.

## Why

- Path A is CSV-driven (client's stated "main reference"), idempotent, and already produces the COMPLETE menu + BOMs + prices.
- Path B (`seed-data.ts`) seeds users/modifiers/orders/channel_revenues that Path A omits, BUT its `RECIPES_DATA` is a stale partial subset that diverges from the CSVs (e.g. Matcha Latte uses different ingredient protoIds; it misses Hojicha Latte, Choco Ichigo Latte, Curry Omurice, Katsu Bento). Keeping it authoritative would let a `seed-full` reset silently drop the new items.
- `recipes-rincian` TRUNCATEs `recipes` CASCADE, which cascade-deletes `recipe_modifier_groups`. So running Path A after Path B wipes the recipe↔modifier links Path B created. With Path A canonical + owning the Tambahan group, this is harmless (Path A re-links on its own run).

## Concrete work this decision spawns (into #39 / #41, no new tickets)

1. **menu-shopeefood migration (Path A)** — `scripts/migrate-csv/menu-shopeefood.ts`, registered AFTER the existing CSV steps in `scripts/migrate-csv/index.ts`:
   - Insert the 6 recipes (#36 delta) with prices + BOMs (#37).
   - Create the shared **Tambahan** modifier group (Tambah Telur → Telor Ayam; Tambah Cabe → Cabe bubuk) — both ingredients already exist.
   - Attach Tambahan to all rice-bowl + ala-carte recipes (per #34 decision 4).
   - Idempotent: upsert-by-code (do NOT TRUNCATE; the CSV steps own truncation). Dry-run path required.
2. **seed-data.ts mirror (Path B, dev-only)** — add the same 6 recipes + Tambahan group so `seed-full` reproduces them. Correct the stale header. This is a mechanical mirror, not a redesign.
3. **AGENTS.md note** — document that `migrate-csv` is the canonical seed; `seed-full`/`setup` is dev-only demo that mirrors it.

## What is NOT changed

- The CSVs stay frozen (the delta lives only in `menu-shopeefood`).
- Users/orders/channel_revenues continue to be seeded only by Path B (dev demo / historical data). The ShopeeFood channel-accounting loader (#42) is separate and also lives in/after Path A or as its own step.
