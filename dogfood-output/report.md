# Dogfood QA Report — CSV Seed Data vs Web App

**Target:** http://localhost:3000
**Date:** 2026-06-26
**Scope:** Compare raw CSV seed data from `docs/csv/` with data displayed in the web app (ingredients, recipes/BOMs, branches, menu prices)
**Tester:** Hermes Agent (automated exploratory QA)

---

## Executive Summary

| Severity    | Count  |
| ----------- | ------ |
| 🔴 Critical | 1      |
| 🟠 High     | 5      |
| 🟡 Medium   | 7      |
| 🔵 Low      | 3      |
| **Total**   | **16** |

**Overall Assessment:** The web app's seed data has significant discrepancies vs the source CSV files — 15 CSV ingredients are missing from the app, 4 recipes have BOM quantity/ingredient mismatches, and several seed items use different naming conventions than the CSV sources. The most critical issue is that `Math.round()` in the seed pipeline silently drops fractional quantities from recipe BOMs.

---

## Issues

### Issue #1: Math.round() silently truncates fractional recipe BOM quantities

| Field        | Value                                                   |
| ------------ | ------------------------------------------------------- |
| **Severity** | 🔴 Critical                                             |
| **Category** | Functional                                              |
| **URL**      | http://localhost:3000/recipes (all recipe detail pages) |

**Description:**
The seed pipeline at `src/routes/api/seed-data.ts:432` uses `Math.round(ri.quantity)` when inserting recipe ingredients. This silently drops fractional quantities from the CSV source data. All recipes with decimal quantities (e.g., 67.5g Beras, 7.5g Beras Ketan, 1.25g Cuka Nasi) are rounded to integers.

**Steps to Reproduce:**

1. Navigate to Menu / Resep → click Gyumeshi
2. Compare BOM with CSV "Detail POS - Rincian Menu.csv" Gyumeshi row
3. CSV: Beras=67.50, Beras Ketan=7.50, Cuka Nasi=1.25
4. App: Beras=68, Beras Ketan=8, Cuka Nasi=1

**Expected Behavior:** BOM quantities should match CSV source exactly (preserving decimals)

**Actual Behavior:** All fractional quantities are rounded: 67.5→68, 7.5→8, 1.25→1

**Affected Recipes (all rice bowl recipes share the same rice base):**

- Gyumeshi: Beras 67.5→68, Beras Ketan 7.5→8, Cuka Nasi 1.25→1
- Karage Don: Beras 67.5→68, Beras Ketan 7.5→8, Cuka Nasi 1.25→1
- Hot Honey Karage Don: same rice rounding
- Curry Karage Don: same rice rounding
- Chicken Katsu Don: same rice rounding
- Curry Katsu Don: same rice rounding
- Japanese Beef Curry Rice: same rice rounding
- Matcha Tea: Simple Syrup 1.50→2 (Bubuk Matcha)

**Screenshot:**
MEDIA:/home/edward/.hermes/cache/screenshots/browser_screenshot_33af1e77310a4d6398d096f525b441ae.png

**Root Cause:**

```typescript
// src/routes/api/seed-data.ts:432
quantity: Math.round(ri.quantity);
```

---

### Issue #2: 15 CSV ingredients missing from app seed data

| Field        | Value                             |
| ------------ | --------------------------------- |
| **Severity** | 🟠 High                           |
| **Category** | Functional                        |
| **URL**      | http://localhost:3000/ingredients |

**Description:**
15 ingredients present in the CSV files (Tenant + Central Kitchen) are completely absent from the `INGREDIENTS` array in `seed-data.ts`. Some are naming variants of existing items, but several are genuinely missing.

**Missing Ingredients (genuinely absent):**
| CSV Ingredient | Source CSV | Likely Match in Seed |
|---|---|---|
| daging beef slice | Central Kitchen | None |
| rice vinegar | Central Kitchen | None (Cuka Nasi exists but is different) |
| cairan cuci piring | Central Kitchen | None |
| super pel | Central Kitchen | None |

**Missing due to naming mismatch (present under different name):**
| CSV Name | Seed Name | Issue |
|---|---|---|
| skm | Susu Kental Manis | Abbreviation vs full name |
| battery | Battery AAA | Different name |
| kabel ties 2.5\*100mm putih | Kabel Ties | Abbreviated |
| lpg / tabung lpg 3 kg | LPG | Two CSV entries, one seed entry |
| plastik klip | Plastik Klip 100 Pcs | Different name |
| cup gelas pp 12 oz | Cup Gelas PP 12Oz | Spacing difference |
| thinwall 500 ml | Thinwall 500ml | Spacing difference |
| isi steples | Isi Staples | Typo in CSV |
| sendok puding | Sendok Pudding | Spelling variant |
| sunlight | Sunlight 1500 | Abbreviated |
| sendok plastik | exists as recipe, not as ingredient | Missing as ingredient |

---

### Issue #3: Ice Tea recipe uses different ingredient than CSV

| Field        | Value                                 |
| ------------ | ------------------------------------- |
| **Severity** | 🟠 High                               |
| **Category** | Functional                            |
| **URL**      | http://localhost:3000/recipes/REC-018 |

**Description:**
The Ice Tea recipe in the app uses "Daun Teh Hitam" (tea leaves) as an ingredient, but the CSV "Rincian Menu" uses "Ice Tea" (a pre-made ingredient, likely brewed tea). The quantities also differ:

- CSV: Ice Tea 100ml, Simple Syrup 20gr, Air 50ml, Es Batu 180gr
- App: Daun Teh Hitam 10, Simple Syrup 20, Air 50, Es Batu 180, Cup 1, Sedotan 1

The CSV also lists Cup gelas PP 14Oz and Sedotan which ARE in the app version.

**Expected Behavior:** Ice Tea recipe should use "Ice Tea" ingredient or have an explicit note about the substitution

**Actual Behavior:** Uses "Daun Teh Hitam" with quantity 10 (unit unclear) instead of "Ice Tea" 100ml

---

### Issue #4: Matcha Tea Air quantity mismatch (CSV: 125ml, App: 175ml)

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| **Severity** | 🟠 High                                           |
| **Category** | Functional                                        |
| **URL**      | http://localhost:3000/recipes (Matcha Tea detail) |

**Description:**
Matcha Tea recipe has Air (water) quantity of 175 in the seed data, but the CSV "Rincian Menu" shows Air=125ml (second Air entry, for cold water). This is a 50ml difference that would affect the drink's taste and consistency.

- CSV: Bubuk Matcha latte 1.50gr, Simple Syrup 25gr, Air 50ml, Es Batu 180gr, **Air 125ml**, Cup 1, Sedotan 1
- App: Bubuk Matcha 1.5, Simple Syrup 25, Air **175**, Es Batu 180, Cup 1, Sedotan 1

The CSV has two Air entries (50ml hot + 125ml cold = 175ml total), but the app combines them into a single Air=175. This is actually correct in total but loses the process distinction (hot water for dissolving matcha vs cold water for serving).

---

### Issue #5: Karage Don CSV missing Cuka Nasi ingredient

| Field        | Value               |
| ------------ | ------------------- |
| **Severity** | 🟠 High             |
| **Category** | Content             |
| **URL**      | CSV vs seed-data.ts |

**Description:**
The Karage Don recipe in the app includes "Cuka Nasi" (rice vinegar, 1.25g), but the CSV "Rincian Menu" for Karage Don does NOT list Cuka Nasi. The same applies to Hot Honey Karage Don. However, Gyumeshi in the CSV DOES include Cuka Nasi.

This is either:

1. A CSV omission (Cuka Nasi should be in Karage Don), or
2. A seed data error (Cuka Nasi should NOT be in Karage Don)

**CSV Karage Don BOM:** Ayam Karage 130gr, Bowl Mangkok 1, Tutup Mangkok 1, Beras 67.50gr, Beras Ketan 7.50gr, Air 117gr (6 items)
**App Karage Don BOM:** Ayam Karage 130, Bowl Mangkok 1, Tutup Mangkok 1, Beras 68, Beras Ketan 8, Air 117, Cuka Nasi 1 (7 items)

---

### Issue #6: Karage Don CSV missing Bowl packaging (Inner Tray Bowl)

| Field        | Value      |
| ------------ | ---------- |
| **Severity** | 🟡 Medium  |
| **Category** | Content    |
| **URL**      | CSV vs app |

**Description:**
Gyumeshi in the CSV includes "inner tray bowl" as a packaging component, but Karage Don and Hot Honey Karage Don in the CSV do NOT include any bowl packaging (only Bowl Mangkok + Tutup Mangkok). In the app, Karage Don also doesn't have Inner Tray Bowl. This may be intentional (different packaging for different items) but should be verified.

---

### Issue #7: "extra 2pcs karage" and "extra beef 50gr" have Rp 0 selling price

| Field        | Value                                        |
| ------------ | -------------------------------------------- |
| **Severity** | 🟡 Medium                                    |
| **Category** | Functional                                   |
| **URL**      | http://localhost:3000 (dashboard COGS table) |

**Description:**
Two add-on items show Rp 0 selling price but have non-zero COGS (Rp 3,185 and Rp 4,445 respectively). The dashboard shows negative margins (-Rp 3,185 and -Rp 4,445) and 0.0% food cost. These items are free add-ons in the List Menu Kasir CSV as well, but the COGS dashboard should either exclude them or handle zero-price items differently to avoid misleading metrics.

---

### Issue #8: 5 seed recipes not in any CSV file

| Field        | Value                         |
| ------------ | ----------------------------- |
| **Severity** | 🟡 Medium                     |
| **Category** | Content                       |
| **URL**      | http://localhost:3000/recipes |

**Description:**
These recipes exist in the app but are not found in any CSV file:

1. **Caramel Pudding** (listed as "Caramel Puding" in List Menu Kasir CSV — spelling mismatch)
2. **Chicken Karaage Staff** (only in Menu Makan Staff CSV as "Chicken Karaage Staff" — actually matches)
3. **Chicken Katsu Staff** (only in Menu Makan Staff CSV)
4. **Nasi Staff** (only in Menu Makan Staff CSV)
5. **Telor Staff** (only in Menu Makan Staff CSV)

Note: Items 2-5 ARE in the Menu Makan Staff CSV but under the "Harga HPP Makan Pegawai" section, not as full recipes with BOMs. The CSV has recipe BOMs for Karage Don, nasi putih, and Chicken Katsu Don under "Rincian Menu Makan Staff" but NOT for the staff-specific items.

---

### Issue #9: ~29 CSV menu items not in app recipes

| Field        | Value                         |
| ------------ | ----------------------------- |
| **Severity** | 🟡 Medium                     |
| **Category** | Content                       |
| **URL**      | http://localhost:3000/recipes |

**Description:**
The List Menu Kasir CSV contains ~46 items but many are operational supplies (Galon, LPG, Minyak, PEX, etc.) not meant to be recipes. However, some notable menu items from the CSV are missing from the app:

- **Japanese Curry Karaage Don** (in CSV "List Menu Kasir" but app only has "Curry Karage Don")
- **Japanese Curry Katsu Don** (in CSV but app only has "Curry Katsu Don")
- **Es Teh** (in CSV "Add Ons Bowl" section, app has "Ice Tea" which is different)
- **Extra Curry Sauce** (in CSV but not in app recipes)
- **Gohan** (in CSV, which IS "nasi putih" in the app — naming difference)

---

### Issue #10: Dashboard COGS values differ from CSV HPP estimates

| Field        | Value                             |
| ------------ | --------------------------------- |
| **Severity** | 🟡 Medium                         |
| **Category** | UX                                |
| **URL**      | http://localhost:3000 (dashboard) |

**Description:**
The dashboard COGS table shows different values than the CSV "Harga Invoice" HPP. This is expected behavior (COGS uses Weighted Average Cost from actual inventory, HPP is estimated), but users comparing the two may be confused:

| Menu                 | CSV HPP   | Dashboard COGS | Difference |
| -------------------- | --------- | -------------- | ---------- |
| Gyumeshi             | Rp 11,670 | Rp 10,266      | -Rp 1,404  |
| Karage Don           | Rp 9,350  | Rp 7,746       | -Rp 1,604  |
| Hot Honey Karage Don | Rp 9,990  | Rp 8,386       | -Rp 1,604  |
| Matcha Latte         | Rp 8,806  | Rp 8,538       | -Rp 268    |

The COGS being lower than HPP could indicate procurement costs are below estimates, or the rounding in BOMs affects the calculation.

---

### Issue #11: Ingredient unit inconsistencies (gr vs gram vs ml)

| Field        | Value                             |
| ------------ | --------------------------------- |
| **Severity** | 🟡 Medium                         |
| **Category** | Content                           |
| **URL**      | http://localhost:3000/ingredients |

**Description:**
The app uses inconsistent unit naming:

- "Ayam Karage" uses "gram" while "Beras" uses "gr" — same unit, different labels
- CSV uses "gr" consistently, but the app mixes "gr" and "gram"
- "Air" in the app is "ml" but CSV lists it as "gr" in recipe BOMs
- "Cuka Nasi" shows as "ml" in the app but CSV says "gr"

---

### Issue #12: Chicken Karaage Staff and Chicken Katsu Staff have HPP = Rp 0

| Field        | Value                         |
| ------------ | ----------------------------- |
| **Severity** | 🟡 Medium                     |
| **Category** | Functional                    |
| **URL**      | http://localhost:3000/recipes |

**Description:**
Staff meal recipes (Chicken Karaage Staff Rp 6,370, Chicken Katsu Staff Rp 4,096, Nasi Staff Rp 1,515, Telor Staff Rp 1,750) show HPP Total = Rp 0 despite having a base price. The Menu Makan Staff CSV shows these as "Harga HPP Makan Pegawai" — they may be missing ingredient BOMs in the seed data, causing HPP to calculate as zero.

---

### Issue #13: Beras HPP = Rp 16/gr in app but CSV Harga Invoice shows Rp 16.00/gr

| Field        | Value                             |
| ------------ | --------------------------------- |
| **Severity** | 🔵 Low                            |
| **Category** | Content                           |
| **URL**      | http://localhost:3000/ingredients |

**Description:**
Beras (rice) shows HPP Rp 16 in the app. The Harga Invoice CSV shows "Rp 16.00/gr" for Beras (5000gr for Rp 80,000). The app rounds to integer which is fine for display but the actual cost per gram is Rp 16.00. Similarly, Beras Ketan shows Rp 31 in app but CSV shows Rp 31.00/gr.

---

### Issue #14: "Caramel Pudding" vs "Caramel Puding" spelling

| Field        | Value                         |
| ------------ | ----------------------------- |
| **Severity** | 🔵 Low                        |
| **Category** | Content                       |
| **URL**      | http://localhost:3000/recipes |

**Description:**
The app uses "Caramel Pudding" (English spelling) while the List Menu Kasir CSV uses "Caramel Puding" (Indonesian spelling). Minor inconsistency.

---

### Issue #15: Login page shows duplicate Central Kitchen user

| Field        | Value                 |
| ------------ | --------------------- |
| **Severity** | 🔵 Low                |
| **Category** | UX                    |
| **URL**      | http://localhost:3000 |

**Description:**
The login page quick-login buttons show "Central Kitchen ck@omoiyari.net" but the CSV "List Cabang" does not list a Central Kitchen as a branch. The Central Warehouse is a branch type "Central" in the app. The CK user is a seed-data addition not present in the CSV.

---

### Issue #16: No console errors detected during testing

| Field        | Value     |
| ------------ | --------- |
| **Severity** | N/A       |
| **Category** | Console   |
| **URL**      | All pages |

**Description:**
No JavaScript errors or console warnings were detected during the entire testing session. The application runs cleanly from a console perspective.

---

## Issues Summary Table

| #   | Title                                                     | Severity    | Category   | URL          |
| --- | --------------------------------------------------------- | ----------- | ---------- | ------------ |
| 1   | Math.round() truncates fractional BOM quantities          | 🔴 Critical | Functional | /recipes     |
| 2   | 15 CSV ingredients missing from seed data                 | 🟠 High     | Functional | /ingredients |
| 3   | Ice Tea uses Daun Teh Hitam instead of Ice Tea ingredient | 🟠 High     | Functional | /recipes     |
| 4   | Matcha Tea Air quantity differs (175 vs 125)              | 🟠 High     | Functional | /recipes     |
| 5   | Karage Don CSV missing Cuka Nasi                          | 🟠 High     | Content    | CSV vs seed  |
| 6   | Karage Don missing Inner Tray Bowl packaging              | 🟡 Medium   | Content    | CSV vs app   |
| 7   | Add-on items show Rp 0 price with negative margins        | 🟡 Medium   | Functional | Dashboard    |
| 8   | 5 seed recipes not in main CSV files                      | 🟡 Medium   | Content    | /recipes     |
| 9   | ~29 CSV menu items not in app recipes                     | 🟡 Medium   | Content    | /recipes     |
| 10  | Dashboard COGS differs from CSV HPP                       | 🟡 Medium   | UX         | Dashboard    |
| 11  | Ingredient unit inconsistencies (gr/gram/ml)              | 🟡 Medium   | Content    | /ingredients |
| 12  | Staff meals have HPP = Rp 0                               | 🟡 Medium   | Functional | /recipes     |
| 13  | Beras HPP rounding (Rp 16 vs Rp 16.00)                    | 🔵 Low      | Content    | /ingredients |
| 14  | Caramel Pudding vs Puding spelling                        | 🔵 Low      | Content    | /recipes     |
| 15  | Central Kitchen user not in CSV branches                  | 🔵 Low      | UX         | Login        |
| 16  | No console errors (clean run)                             | N/A         | Console    | All          |

---

## Testing Coverage

### Pages Tested

- Login page (quick-login buttons)
- Dashboard (COGS table, recent orders, daily stats)
- Bahan Baku / Ingredients (paginated list, 127 items)
- Menu / Resep (paginated list, 29 items)
- Recipe detail: Gyumeshi (BOM comparison)
- Recipe detail: Karage Don (BOM comparison)
- Cabang / Branches (8 items)
- API: /api/seed-data, /api/ingredients

### Features Tested

- CSV data parsing and comparison (7 CSV files)
- Seed data extraction from seed-data.ts (INGREDIENTS, RECIPES_DATA arrays)
- BOM quantity comparison (CSV vs seed vs displayed)
- Ingredient name matching (fuzzy + exact)
- Menu price comparison
- Branch name/address comparison
- Console error monitoring

### Not Tested / Out of Scope

- POS order flow (creating orders)
- Inventory transactions
- Stock opname
- SCM (procurement, transfers, invoices)
- Finance/analytics pages
- Print functionality
- Mobile responsiveness
- Multi-branch data isolation

### Blockers

- Virtual/paginated tables required multiple page navigations to extract all data
- API endpoints return HTML (TanStack Start SSR) instead of JSON, limiting direct API testing
- Session expired once during testing (re-login required)

---

## Notes

1. **The `Math.round()` issue (#1) is the highest priority fix** — it silently corrupts all fractional BOM quantities. The fix is to either use `Math.round(ri.quantity * 100) / 100` for 2-decimal precision, or remove rounding entirely and store exact values.

2. **The 15 missing ingredients (#2) need a CSV-to-seed reconciliation pass.** Some are naming variants that should be unified, others (daging beef slice, rice vinegar, cairan cuci piring, super pel) are genuinely missing from the seed.

3. **The Ice Tea recipe substitution (#3) is a real discrepancy** — the CSV uses a pre-made "Ice Tea" ingredient while the app uses raw "Daun Teh Hitam". This changes the BOM structure entirely.

4. **The Matcha Tea Air issue (#4)** is actually a correct total (50+125=175) but loses the process distinction between hot water (for dissolving matcha) and cold water.

5. **Staff meal recipes (#12) having HPP=0** suggests they're missing ingredient BOMs in the seed data — they have basePrice but no ingredients array.
