# menu-shopeefood migration module — design (resolved by wayfinder #39)

## Status

Decision ticket. All design questions resolved by HITL grilling. Implementation is #41.

## Placement (from #44)

New module `scripts/migrate-csv/menu-shopeefood.ts`, registered in
`scripts/migrate-csv/index.ts` AFTER the existing CSV steps (`recipes-rincian`,
`menu-kasir`, `staff-menu`, `harga-invoice`). Path A (`migrate-csv`) is canonical;
this module owns the ShopeeFood delta + the shared Tambahan modifier group.

## Mechanics

- **Code scheme**: continue `REC-NNN` from the current max (same query pattern as
  `recipes-rincian.ts`: `SELECT code FROM recipes WHERE code ~ '^REC-[0-9]+$' ORDER
BY code DESC LIMIT 1`). Modifier group `MG-005`; modifiers `MOD-014` (Tambah
  Telur), `MOD-015` (Tambah Cabe).
- **Idempotent upsert-by-name** (mirror `menu-kasir.ts`): look up recipe by
  lowercased name; the 6 are never in the CSVs so they always INSERT. BOM rows and
  `recipe_modifier_groups` links inserted only when absent. **NO TRUNCATE** — the CSV
  steps own truncation; this module layers on top.
- **dry-run**: parse + print what would be inserted, no DB writes (same convention as
  the other migrations).

## The 6 recipes (delta from #36), prices = HPP × category markup (decision #39-1)

| Item                     | HPP      | Category | Markup | basePrice |
| ------------------------ | -------- | -------- | ------ | --------- |
| Choco Latte              | 6013.63  | minuman  | 3.5×   | 21000     |
| Hojicha Latte            | 8150.63  | minuman  | 3.5×   | 28500     |
| Choco Ichigo Latte       | 7131.43  | minuman  | 3.5×   | 25000     |
| Curry Omurice            | 9229.59  | makanan  | 3×     | 27700     |
| Japanese Caramel Pudding | 2064.84  | snack    | 3.5×   | 7200      |
| Katsu Bento              | 10521.31 | makanan  | 3×     | 31600     |

(totalCogs = HPP from Excel LIST HPP; isBOGO = false)

## BOMs (from #37; every ingredient already exists in the master)

- **Choco Latte**: `Choco Latte`(powder) 1, `Susu Fresh Milk` 125, `Air` 50, `Es
Batu` 180, `Simple Syrup` 15, `Cup gelas PP 14Oz` 1, `Sedotan` 1.
- **Hojicha Latte**: `Bubuk Hojicha` 1, `Susu Fresh Milk` 125, `Air` 50, `Es Batu`
  180, `Simple Syrup` 15, `Cup gelas PP 14Oz` 1, `Sedotan` 1.
- **Choco Ichigo Latte**: `Choco Latte` 1, `Strawberry Sauce` ~20, `Susu Fresh Milk`
  125, `Air` 50, `Es Batu` 180, `Simple Syrup` 15, `Cup gelas PP 14Oz` 1, `Sedotan` 1.
- **Curry Omurice**: rice base (`Beras` 67.5, `Beras Ketan` 7.5, `Air` 117, `Cuka
Nasi` 1.25, `Bowl Mangkok` 1, `Tutup Mangkok` 1, `inner tray bowl` 1) + `Curry
Sauce` 1 + `Telor Ayam` 1 + `Daun Bawang` 1.
- **Japanese Caramel Pudding**: `Pudding Caramel` 1, `Susu Fresh Milk` ~100, `Telor
Ayam` 1, `Vanili Pasta` ~1, `Sendok Puding` 1, `Cup gelas PP 12 oz` 1.
- **Katsu Bento**: `Katsu Chicken` 1 + rice base + `Bento Tray` 1 + side (`Edamame`
  / `Egg Roll` 1).

## Shared Tambahan modifier group (decision #39-2)

- Group `MG-005` "Tambahan": minSelection 0, maxSelection 2.
- `MOD-014` "Tambah Telur": price 5000, ingredient `Telor Ayam` qty 1 (mirrors
  existing "Extra Telur Mata Sapi" precedent in seed-data.ts).
- `MOD-015` "Tambah Cabe": price 1000, ingredient `Cabe bubuk` qty 5 (gr).
- Both via `modifier_ingredients` (update COGS on order).

## Attachment scope (decision #39-3)

Insert `recipe_modifier_groups` link for **every recipe whose category ∈
{makanan, snack, add_ons}** — i.e. rice bowls, ala carte, bento, pudding. NOT
attached to `minuman` (drinks). This matches the #34 "rice-bowl + ala-carte"
decision. The group is created once; the link loop runs over the live `recipes`
table (so it also attaches to the pre-existing CSV recipes, not just the 6 new).

## Path B mirror (from #44)

Add the same 6 recipes (RECIPES_DATA) + Tambahan group (MODIFIER_GROUPS_DATA) into
`src/lib/seed/seed-data.ts` so `vp run seed-full` (dev-only demo) reproduces them.
Correct the stale "deprecated" header. This is a mechanical mirror, no redesign.

## Verification

- `vp run migrate-csv --only menu-shopeefood --dry-run` prints 6 recipe inserts +
  Tambahan group + link count.
- `vp run migrate-csv` (full) then a second run must be a no-op (idempotent).
- `vp run test` / `vp check` pass.
