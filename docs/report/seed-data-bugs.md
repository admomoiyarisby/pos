# Seed-Data Bugs — Status

These are bugs in the demo seed data, not in the runtime code. They produce incorrect data on the Vercel demo but do not affect production deployments with real data. Fix by correcting the seed data and re-seeding the demo database.

---

## F04: Waste references assigned IN type in `STOCK_LEDGER_DATA` ✅ FIXED

**Status:** Fixed in `fix(seed): fix stock ledger types, add current-day orders, and seed recipe BOMs`

The IN/OUT type was assigned by `i % 3`, ignoring reference type. Now WASTE and POS are always OUT, DELIVERY is always IN.

---

## F07: Most POS menu items HABIS — ingredient proto ID mismatch ✅ FIXED

**Status:** Fixed in `fix(seed): fix ingredient proto ID mismatch in inventory seeding`

Proto IDs had hyphens (`"ing-01"`) but actual IDs use leading zeros (`"ing001"`). Fixed by correcting the list.

---

## F08: Dashboard 'Penjualan Hari Ini' = Rp 0 — seed orders miss the current day ✅ FIXED

**Status:** Fixed in `fix(seed): fix stock ledger types, add current-day orders, and seed recipe BOMs`

"New" and "Processing" orders now always have `daysAgo: 0` so they appear on the dashboard's "today" filter.

---

## F09: Zero `averageCost` and missing recipe BOMs ✅ PARTIALLY FIXED

**Status:** Partially fixed in two commits

- `fix(seed): store averageCost per stock unit` — Fixed 5 ingredients (Susu Fresh Milk, Tepung Ketan, Sedotan, Cup gelas PP 14Oz, Minyak Goreng)
- `fix(seed): fix stock ledger types, add current-day orders, and seed recipe BOMs` — Added BOM data for 17 out of 29 recipes. Previously only 2 recipes had ingredients.

Remaining: ~60 minor ingredients still have `averageCost: 0` (Baking Powder, Bawang Bombay, etc.). These are low-impact ingredients not used in the main menu items.

---

## F02: POS price Rp 0 but Analytics reports non-zero revenue ✅ WORKING AS DESIGNED

POS shows current `basePrice`. Analytics shows historical snapshotted prices. The disagreement is correct behavior per FRD §4.6.

---

## F13: Period Control shows 'Mei 2026' as open ✅ FIXED

**Status:** Fixed in `fix(waste,inventory,users,seed): add units to waste/ledger, fix F12/F13`

Closed May 2026 and opened June 2026 in the seed data.
