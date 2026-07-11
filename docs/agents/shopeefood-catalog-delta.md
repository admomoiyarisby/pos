# ShopeeFood catalog delta (resolved by wayfinder #36)

## Method

- **ShopeeFood catalog source:** `docs/excel/File Omoiyari Pembukuan TENANT (Mulyorejo)-(Juni,2026).xlsx` → sheet **LIST HPP** (30 finished items with real `HPP` cost). This is the authoritative ShopeeFood menu — the workbook's other sheets mix finished products with raw ingredients / packaging / LPG, so the LIST HPP sheet is the clean catalog.
- **Existing CSV menu source:** `docs/csv/Detail POS - Rincian Menu.csv` (recipe/BOM names) cross-checked with `Detail POS - List Menu Kasir.csv` (cashier prices).

## Key correction to the map's assumption

The map assumed the CSVs _omit_ the drinks and Chicken Katsu Don. They do NOT — `Rincian Menu` already contains **Matcha Latte, Matcha Tea, Ice Tea, Chicken Katsu Don, Curry Karage Don, Curry Katsu Don, Miso Sup, Japanese Beef Curry Rice, Gyumeshi, Karage Don/Ala Carte, Hot Honey variants, Gyuniku Ala Carte, Curry Sauce, Spicy Sauce, nasi putih, extra beef/karage**. So the true delta is much smaller than first estimated.

## The actual menu delta — 6 finished products NOT in the CSVs

All have a real HPP from the Excel LIST HPP sheet (so no cost needs inventing):

| Item                     | HPP (Excel) | Category        | Notes                                                                         |
| ------------------------ | ----------- | --------------- | ----------------------------------------------------------------------------- |
| Choco Latte              | 6013.63     | Minuman (drink) | needs BOM + price                                                             |
| Hojicha Latte            | 8150.63     | Minuman (drink) | needs BOM + price                                                             |
| Choco Ichigo Latte       | 7131.43     | Minuman (drink) | has HPP (map's "no HPP" fog item now RESOLVED — cost known, only BOM missing) |
| Curry Omurice            | 9229.59     | Makanan (rice)  | needs BOM + price                                                             |
| Japanese Caramel Pudding | 2064.84     | Snack/dessert   | needs BOM + price                                                             |
| Katsu Bento              | 10521.31    | Makanan (bento) | needs BOM + price                                                             |

## 4 items that LOOK like menu items but are NOT (out of menu scope)

`cabe bubuk` (249.5), `saus sambal sachet` (296.0), `saus tomat sachet` (235.0), `sendok plastik` (208.0) appear in LIST HPP. They are **already ingredients/operational supplies** in `Detail POS - List Item Central Kitchen.csv` and `List Item Tenant (Cabang).csv`, and are priced `FREE` in Menu Kasir. They belong in inventory, not as ShopeeFood menu recipes. Excluded from the menu rewrite.

## Already-covered items (no action needed)

Matcha Latte, Matcha Tea, Ice Tea, Chicken Katsu Don, Curry Karage Don, Curry Katsu Don, Miso Sup, Japanese Beef Curry Rice, Gyumeshi, Karage Don, Karage Ala Carte, Hot Honey Karage Don/Ala Carte, Gyuniku Ala Carte, Curry Sauce, Spicy Sauce, nasi putih, extra 2pcs karage, extra beef 50gr — all present in CSV Rincian Menu.

## Open sub-questions for #37 (drink BOMs) and #39 (design)

- BOM composition for the 6 new items (drinks especially — need matcha/hojicha/choco powder, milk, ice, etc.; pudding; bento box; omurice).
- Menu Kasir has NO price row for these 6 → offline selling price must be set (HPP is known; retail price needs a decision — likely HPP × markup, or taken from ShopeeFood sale price if derivable from the daily sheets' "Total"/"Jumlah").
- Whether the LIST HPP sheet is brand-wide (likely) vs Mulyorejo-only — if brand-wide, the 6 new items apply to ALL branches (matches the #34 destination).
