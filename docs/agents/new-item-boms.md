# Drink / new-item BOMs + missing-ingredient audit (resolved by wayfinder #37)

## Method

Modeled each of the 6 new items (#36 delta) on the **existing** Omoiyari recipes in
`docs/csv/Detail POS - Rincian Menu.csv` (Matcha Latte, Matcha Tea, Ice Tea,
Miso Sup, Curry Katsu Don, Gyumeshi, Karage Don, Japanese Beef Curry Rice), and
checked every component against the ingredient masters
`Detail POS - List Item Central Kitchen.csv` + `List Item Tenant (Cabang).csv`.

## CRITICAL FINDING: no new ingredients are required

Every component of all 6 new items ALREADY EXISTS in the ingredient master.
In particular, the "missing cabe ingredient" from the map is now RESOLVED:
**`Cabe bubuk` already exists** (it's in both ingredient CSVs and is priced in
Menu Kasir). So the Tambah Cabe modifier can use `Cabe bubuk` directly — no
schema/ingredient addition needed. Telor Ayam (for Tambah Telur) also already
exists.

Relevant existing ingredients confirmed present:

- Drinks: `Bubuk Matcha latte`, `Bubuk Hojicha`, `Choco Latte` (chocolate-latte
  powder mix), `Cocoa Powder`, `Susu` / `Susu Fresh Milk`, `Es Batu`, `Air`,
  `Simple Syrup`, `Cup gelas PP 14Oz` / `12 oz`, `Plastik Sealer Cup`,
  `Sedotan`, `Creamer Bubuk`, `SKM`, `Vanili Pasta`, `Strawberry Sauce`,
  `Daun Teh Hitam`, `Teh Wayang`.
- Food: `Curry Sauce`, `Curry Pasta`, `Katsu Chicken`, `Dada Ayam Mentah`,
  `Paha Ayam`, `Beras`, `Beras Ketan`, `Bento Tray`, `Egg Roll`, `Pudding
Caramel`, `Telor Ayam`, `Daun Bawang`, `Wakame`, `Edamame`, `Mangkok soup
300ml`, `Bowl Mangkok`, `Tutup Mangkok`, `inner tray bowl`.

## Proposed BOMs (modeled on existing recipes; quantities in the CSV's gr/ml/pcs)

### Drinks (template = Matcha Latte: Simple Syrup + Air + Es Batu + Susu Fresh Milk + Cup 14Oz + Sedotan)

- **Choco Latte** (HPP 6013.63): `Choco Latte` (powder) 1, `Susu Fresh Milk` 125,
  `Air` 50, `Es Batu` 180, `Simple Syrup` 15, `Cup gelas PP 14Oz` 1, `Sedotan` 1.
- **Hojicha Latte** (HPP 8150.63): `Bubuk Hojicha` 1, `Susu Fresh Milk` 125, `Air` 50,
  `Es Batu` 180, `Simple Syrup` 15, `Cup gelas PP 14Oz` 1, `Sedotan` 1.
- **Choco Ichigo Latte** (HPP 7131.43): `Choco Latte` 1, `Strawberry Sauce` ~20,
  `Susu Fresh Milk` 125, `Air` 50, `Es Batu` 180, `Simple Syrup` 15,
  `Cup gelas PP 14Oz` 1, `Sedotan` 1. (Ichigo = strawberry; HPP sits between
  Choco and Matcha, consistent with added strawberry sauce.)

### Food (template = Curry Katsu Don / Gyumeshi rice base + curry + protein)

- **Curry Omurice** (HPP 9229.59): rice base (`Beras` 67.5, `Beras Ketan` 7.5,
  `Air` 117, `Cuka Nasi` 1.25, `Bowl Mangkok` 1, `Tutup Mangkok` 1, `inner tray
bowl` 1) + `Curry Sauce` 1 + `Telor Ayam` 1 (omelette) + `Daun Bawang` 1.
- **Japanese Caramel Pudding** (HPP 2064.84): `Pudding Caramel` 1, `Susu Fresh
Milk` ~100, `Telor Ayam` 1, `Vanili Pasta` ~1, `Sendok Puding` 1, `Cup gelas
PP 12 oz` 1.
- **Katsu Bento** (HPP 10521.31): `Katsu Chicken` 1, rice base (`Beras` 67.5,
  `Beras Ketan` 7.5, `Air` 117, `Cuka Nasi` 1.25, `Bowl Mangkok` 1, `Tutup
Mangkok` 1) + `Bento Tray` 1 + side `Edamame` / `Egg Roll` 1.

> Quantities for powder/dairy are 1 "portion" units as the CSV uses for single-
> serve mixes (e.g. `Choco Latte` powder is itself a portioned SKU). Exact gram
> weights for powder/dairy should be confirmed in #39, but every SKU referenced
> already exists, so no ingredient migration is needed.

## Modifier note (feeds #39)

- **Tambah Telur** → ingredient `Telor Ayam` (exists). Quantity TBD (1 pc).
- **Tambah Cabe** → ingredient `Cabe bubuk` (exists — resolves the map's "cabe
  not yet an ingredient" worry). Quantity TBD.

## Open for #39 (design)

- Exact portion quantities for powder/dairy SKUs (the CSV treats them as 1-unit
  portioned SKUs; confirm with client or weigh).
- Retail (offline) price for each of the 6 — Menu Kasir has none; use HPP × markup
  or derive from ShopeeFood daily "Total/Jumlah".
- Whether these 6 are brand-wide (LIST HPP appears brand-wide) → all branches.
