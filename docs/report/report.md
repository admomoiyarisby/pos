# Omoiyari POS — Dogfood QA Report

**Target:** https://omoiyaripos.vercel.app (TanStack Start SPA on Vercel)
**Tester:** Hermes dogfood skill, logged in as `superadmin@omoiyari.net` (Super Admin)
**Date of test:** 23 June 2026
**Scope:** Full-app sweep — every nav link walked, plus modal/dialog CRUD on Voucher (create+soft-disable) and Pengguna (create+attempted-status-change+attempted-delete). Minimal state mutation: created 1 user (Test User QA) and 1 voucher (TESTQA01) which have been soft-disabled but not removed.

---

## Executive summary

**32 findings** total. Breakdown by severity:

| Severity | Count |
| -------- | ----- |
| CRITICAL | 4     |
| HIGH     | 8     |
| MEDIUM   | 7     |
| LOW      | 10    |
| INFO     | 3     |

**Top themes:**

- **Financial data is broken in 4 different ways** — Dashboard COGS, Recipes HPP, Stock value widget, and Waste loss value are all internally inconsistent or zero, with no obvious way to know which is the source of truth. The WAC/HPP pipeline needs an audit. (F01, F02, F03, F05, F06, F08, F09, F32, F33)
- **Inventory accounting is silently inverted** — waste events write INBOUND stock movements to the ledger, inflating stock on every waste event. (F04)
- **User CRUD is half-broken** — creating a user drops the branch assignment, and the only way to disable a user is via a path that returns 'Forbidden: insufficient role' even for Super Admin. (F10, F11, F12)
- **POS is functionally broken at every branch** — almost every main-dish item is 'HABIS' at Central Warehouse and Darmo Permai; only staff-priced items, Rp 0 add-ons, and one BOGO promo are available. (F07)
- **Charts and units are missing** across many pages — Recharts emits 6+ width/height warnings on the dashboard, and Qty/Saldo/Jumlah columns on Waste, Kartu Stok, and Recipe BOM don't show units, so a value of 117 could mean 117 g or 117 kg. (F15, F21, F23, F24)
- **Auth/session desync** — on first hit of `/admin/branches` the user briefly renders as 'Branch Admin / Unknown' before settling to Super Admin. Could allow a wrong-permission render cycle. (F27)

---

### F01: Matcha Latte COGS calculated at 80x selling price **[CRITICAL]**

- **Category:** Data/Financial
- **URL:** `/dashboard`

Dashboard COGS shows Matcha Latte COGS Rp 2.265.640, margin Rp -2.237.640, food cost 8091.6% on a Rp 28.000 menu. Impossible — COGS is ~80x the price. Caused by runaway recipe multiplier or wrong unit conversion (treating 1 ml as 1 L).

**Evidence:** Dashboard 'Analisis COGS' row: Matcha Latte | Rp 28.000 | Rp 2.265.640 | Rp -2.237.640 | 8091.6% | BIAYA TINGGI

---

### F02: POS price Rp 0 but Analytics reports non-zero revenue for the same item **[CRITICAL]**

- **Category:** Data/Financial
- **URL:** `/pos, /dashboard, /analytics`

'extra 2pcs karage' and 'extra beef 50gr' have POS price Rp 0 and Recipes Harga Dasar Rp 0, yet Analytics 'Top Sales' reports extra 2pcs karage 14 units / Rp 448.000, Spicy Sauce 12 / Rp 780.000, Ice Tea 10 / Rp 180.000 (POS prices Rp 12.000 / Rp 8.000). The three pages disagree on price.

**Evidence:** Recipes REC-012, REC-013 = Rp 0. POS card shows Rp 0. Analytics Top Sales: extra 2pcs karage 14/Rp 448.000, Spicy Sauce 12/Rp 780.000, Ice Tea 10/Rp 180.000.

---

### F04: Waste events recorded as INBOUND stock in Kartu Stok **[CRITICAL]**

- **Category:** Data/Financial
- **URL:** `/inventory/ledger`

Kartu Stok rows show Tipe='IN' (incoming) with Keterangan 'Masuk stok ing012 / ing017' but Referensi is WASTE-20. Waste should reduce stock. The sign or movement-type is being written backwards, silently inflating stock on every waste event.

**Evidence:** Rows: '19 Jun 12.42 | Creamer Bubuk | IN | 4.750 | 55.900 | WASTE-20 | Masuk stok ing012' and same for Plastik Sealer Cup.

---

### F10: Creating a new user drops the Cabang (branch) assignment **[CRITICAL]**

- **Category:** Functional
- **URL:** `/admin/users`

Created user 'Test User QA' as Branch Admin / Omoiyari Wiyung. After save, table shows Cabang='-'. Re-opening Edit confirms branchId is empty. The branchId value is being dropped on submit (client, API, or schema mismatch). A Branch Admin without a branch is broken — no POS terminal, no unique PIN.

**Evidence:** Test User QA row: 'Branch Admin | - | 1234 | Aktif'. Edit dialog shows 'Pilih Cabang --' as the value of the Cabang select.

---

### F03: Dashboard COGS ≠ Recipes HPP for the same menu item **[HIGH]**

- **Category:** Data/Financial
- **URL:** `/dashboard vs /recipes`

For the same menu, Dashboard 'Analisis COGS' and Recipes 'HPP Total' return different numbers. Diff is typically Rp 1,400-1,700 per item, but some items only appear in one page (Karage Don, Japanese Beef Curry Rice, Karage Ala Carte, Matcha Latte, nasi putih, Ice Tea are in Dashboard but missing from Recipes).

**Evidence:** See /tmp/dogfood-omoiyari/data/dashboard_cogs_issues.json. Examples: Gyumeshi 10.266 vs 11.670, Chicken Katsu Don 5.761 vs 7.445, Curry Karage Don 9.946 vs 11.550, Hot Honey Karage Don 8.386 vs 9.990.

---

### F05: Nilai Kerugian (loss value) shows Rp 0 across all waste entries **[HIGH]**

- **Category:** Data/Financial
- **URL:** `/waste`

'Total Kerugian Waste Rp0' header and every Nilai Kerugian cell is 'Rp0' even though hundreds of grams of ingredients are being recorded as waste. The financial loss is incalculable. With WAC pricing available, the loss value should not be zero.

**Evidence:** /waste — 'Total Kerugian Waste Rp0' widget; all rows show 'Rp0' in Nilai Kerugian column.

---

### F06: Stock-value widget shows absurd per-unit prices **[HIGH]**

- **Category:** Data/Financial
- **URL:** `/dashboard`

Dashboard 'Selisih' widget: 'Plastik Sealer Cup 825 / Rp 24.750.000' = Rp 30.000/piece (sealer cups should be <Rp 1.000). 'Tepung Ketan 900 gr / Rp 9.900.000' = Rp 11.000/gr. The HPP source-of-truth is corrupt or the dashboard is multiplying by purchase price instead of WAC.

**Evidence:** Dashboard Selisih rows: Plastik Sealer Cup 825/Rp 24.750.000, Tepung Ketan 900/Rp 9.900.000, Telor Ayam 925/Rp 1.665.000, Plastik Sealer Cup 625/Rp 18.750.000, etc.

---

### F07: Most POS menu items are HABIS (out of stock) for all branches **[HIGH]**

- **Category:** Functional
- **URL:** `/pos`

On Entry Pesanan, 18+ main-dish items show the 'HABIS' badge and are disabled at Central Warehouse and at Omoiyari Darmo Permai. Only staff-priced items (Chicken Karaage Staff, Nasi Staff, Telor Staff), Rp 0 add-ons (cabe bubuk, saus sachet, sendok plastik), and the BUY 1 GET 1 promo are active. A customer cannot place a normal order.

**Evidence:** POS page button text: 'HABIS Chicken Katsu Don Rp 24.000 [disabled]', 'HABIS Curry Karage Don Rp 35.000 [disabled]', 'HABIS Gyumeshi Rp 33.000 [disabled]', etc.

---

### F08: Dashboard 'Penjualan Hari Ini' = Rp 0 despite many orders today **[HIGH]**

- **Category:** Data/Financial
- **URL:** `/dashboard vs /order-history`

Dashboard 'Penjualan Hari Ini Rp 0' and 'Pesanan Selesai 0'. Order History for 22 Jun shows 10+ orders totalling Rp 2M+ with statuses New/Processing/Completed/Cancel Requested. Dashboard may be filtering to Completed only, or has a date/TZ bug, or reads the wrong period. Same Rp 0 on the Finance page.

**Evidence:** Order history 22 Jun: SF-20250139 Rp 127.600 Cancel Requested, DI-20250080 Rp 279.400 New, GR-20250022 Rp 206.800 New, GR-20250062 Rp 217.800 New, GR-20250102 Rp 280.500 New, etc.

---

### F09: Many Bahan Baku ingredients have HPP = Rp 0 **[HIGH]**

- **Category:** Data/Financial
- **URL:** `/ingredients`

127 ingredients, many show HPP 'Rp 0' including Air, Ajinomoto, Ayam Cincang, Baking Powder, Bawang Bombay, Bawang Putih, Bawang Putih Bubuk, Bayam. This is the upstream cause of dual-source COGS/HPP discrepancies.

**Evidence:** /ingredients table shows HPP 'Rp 0' for 8+ ingredients in the first 12 visible rows.

---

### F11: Super Admin cannot change Status to Nonaktif — 'Forbidden: insufficient role' **[HIGH]**

- **Category:** Permissions
- **URL:** `/admin/users`

Edit Pengguna dialog: changing Status to 'Nonaktif' and clicking Simpan returns inline error 'Forbidden: insufficient role'. Form does not close, no change persisted. There is no working UI path to disable a user from the system.

**Evidence:** After clicking Simpan, the dialog stays open and shows 'Forbidden: insufficient role' under the Status field.

---

### F27: Auth/session desync: /admin/branches first paints as 'Branch Admin / Unknown' before settling to Super Admin **[HIGH]**

- **Category:** Security/Functional
- **URL:** `/admin/branches (and other admin pages on first nav)`

Navigating to /admin/branches as Super Admin first paints sidebar role='Branch Admin', main area=POS page with branch='Unknown', and limited nav (POS, Inventaris, Mutasi Stok, Pengadaan only). After a reload, the session settles to Super Admin and shows the correct Cabang page. A user could end up in the wrong role/permission set for a render cycle.

**Evidence:** browser_navigate to /admin/branches initially rendered role 'Branch Admin', branch 'Unknown', POS page. After reload + re-login, role is 'Super Admin' and the Cabang page renders.

---

### F12: User-action button label mismatches the dialog it opens **[MEDIUM]**

- **Category:** UX
- **URL:** `/admin/users`

The action-column button is labelled 'Nonaktifkan melalui edit' (Disable through edit) but clicking it opens a 'Pengguna Tidak Dapat Dihapus' dialog that just says 'disable via Edit'. Combined with F11, the path it points to is broken.

**Evidence:** Button 'Nonaktifkan melalui edit' opens dialog 'Pengguna Tidak Dapat Dihapus' with body 'Untuk menonaktifkan akses, ubah status menjadi "Nonaktif" melalui menu Edit.'

---

### F13: Period Control: 'Mei 2026' is Terbuka (open) but today is 23 June 2026 **[MEDIUM]**

- **Category:** Process
- **URL:** `/period-control`

Period Control shows 'Mei 2026 | Terbuka | 1/5/2026 | -' as the open period. Today is 23 Jun 2026, so an old month is still open and any new period cannot be opened. The auto-roll-forward logic is missing or not run.

**Evidence:** Period Control table row: 'Mei 2026 | Terbuka | 1/5/2026 | -'.

---

### F14: Recipe detail page missing the menu name heading **[MEDIUM]**

- **Category:** Visual/UX
- **URL:** `/recipes/<id>`

Recipe detail pages have no h1 and no breadcrumb. The user sees KATEGORI / HARGA DASAR / HPP TOTAL / STATUS / Bahan (BOM) but is never told which menu they are editing. Dangerous for an Edit flow.

**Evidence:** /recipes/16b33488 body text starts with 'Edit Menu, Hapus, KATEGORI Makanan, HARGA DASAR Rp 24.000, HPP TOTAL Rp 7.445' — no menu name.

---

### F15: Recipe BOM 'Jumlah' column has no unit **[MEDIUM]**

- **Category:** Data/UX
- **URL:** `/recipes/<id>`

BOM Jumlah column shows bare numbers (1, 10, 1, 1, 68, 8, 117, 1, 1) with no unit. Inventory pages do show 'ml' and 'gr' — so the unit is present in the data but missing on this page. 117 could mean 117 g or 117 kg — a 1000x error waiting to happen.

**Evidence:** Chicken Katsu Don BOM: Katsu Chicken 1, Saus Manis Jepang 10, Bowl Mangkok 1, Tutup Mangkok 1, Beras 68, Beras Ketan 8, Air 117, Cuka Nasi 1, Daun Bawang 1 — all bare numbers.

---

### F17: Voucher form: required 'Berlaku Sampai' defaults to 0/0/0/0/0/0 — submit silently no-ops **[MEDIUM]**

- **Category:** UX/Functional
- **URL:** `/admin/vouchers`

The validUntil datetime field is required but defaults to Month=0, Day=0, Year=0, Hours=0, Minutes=0. Submitting with these zeros does not show an error, does not close the dialog, looks broken. Only after setting validUntil to 2026-12-31T23:59 did the voucher actually create.

**Evidence:** Tambah Voucher dialog with validUntil all zeros — no error, no close, no creation. After setting validUntil=2026-12-31T23:59 the voucher TESTQA01 appeared in the table.

---

### F21: Recharts warning: 'width(-1) and height(-1) of chart should be greater than 0' **[MEDIUM]**

- **Category:** Console/Visual
- **URL:** `/dashboard, /analytics`

Browser console emits 6+ identical Recharts warnings on dashboard load. The chart container starts at 0×0 and the chart later renders. Layout is briefly broken or permanently 0-sized for some widgets.

**Evidence:** browser_console on /dashboard: 6x 'Warning: The width(-1) and height(-1) of chart should be greater than 0, please check the style of container...'

---

### F26: Tren Penjualan 7 Hari: filter by toDateString() may include/exclude orders based on local TZ **[MEDIUM]**

- **Category:** Functional
- **URL:** `/dashboard`

Bundle code: 'for r=6;r>=0;r-- { let i = new Date(Date.now()-r\*864e5); let a = e.filter(e => new Date(e.createdAt).toDateString() === i.toDateString()); t.push(...) }'. Uses toDateString() (local TZ). If the local TZ differs from the server TZ, the chart shows the wrong 7 days. Also drops orders missing createdAt silently.

**Evidence:** /tmp/dogfood-omoiyari/data/dashboard.js — toDateString() loop found.

---

### F16: Edit Pengguna: PIN placeholder '1234' overlaps the actual value **[LOW]**

- **Category:** Visual/UX
- **URL:** `/admin/users`

Edit Pengguna PIN field has placeholder='1234' (visible) and the actual saved value is also '1234'. Both render simultaneously so the field looks blank. If a user has a different PIN, the placeholder still says 1234 — actively misleading.

**Evidence:** Edit dialog: 'textbox "1234" [ref=e4] StaticText "1234"' — both placeholder and value shown.

---

### F18: Voucher duplicate-code submission silently no-ops **[LOW]**

- **Category:** UX
- **URL:** `/admin/vouchers`

Submitting Tambah Voucher with Kode='PROMO10' (duplicate) shows no error and the dialog stays open. The user can't tell whether the submission was rejected, still pending, or just slow.

**Evidence:** Tambah Voucher with Kode=PROMO10: no toast, no inline error, dialog remained open.

---

### F19: Print Requests page: description and empty-state copy are in DOM but not rendered **[LOW]**

- **Category:** UX
- **URL:** `/print-requests`

Other admin pages (Voucher, Pengguna, Cabang) render both h1 + description paragraph + empty-state. /print-requests only renders the h1 in the accessibility tree. The description 'Review dan approve permintaan re-print struk dari kasir' and empty-state 'Permintaan dari kasir akan muncul di sini' exist in document.body.innerText but not in the accessibility tree snapshot — looks like a CSS layout bug that hides them.

**Evidence:** browser_snapshot shows only h1; document.body.innerText shows both description and empty state are present in the DOM.

---

### F20: Three pages have no h1 heading: /yield-tracking, /scm-procurements, /period-control **[LOW]**

- **Category:** Accessibility
- **URL:** `/yield-tracking, /scm-procurements, /period-control`

Yield Tracking, Pengadaan, and Period Control pages do not have any h1 (or even h2). The rest of the app consistently uses an h1 per page. Screen readers and tab titles are degraded.

**Evidence:** browser_snapshot of each of the three pages — main element contains only buttons/widgets and a table, no heading.

---

### F22: Dialog a11y warning: 'Missing Description or aria-describedby for DialogContent' **[LOW]**

- **Category:** Accessibility
- **URL:** `/admin/users (and any Radix Dialog)`

Tambah Pengguna and Tambah Voucher dialogs do not provide a DialogDescription. Screen readers can't announce the dialog's purpose. Fix: add a sr-only DialogDescription or aria-describedby pointing to existing helper text.

**Evidence:** browser_console after opening Tambah Pengguna: 'Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.'

---

### F23: Waste 'Qty' column has no unit **[LOW]**

- **Category:** Data/UX
- **URL:** `/waste`

Waste Qty shows bare numbers (100, 675, 75, 700, 725, 100, 125, 750, 150, 775, 175, 800, 825, 200). Inventory pages do show units (gr, ml, pcs). 100 ml water is trivial; 100 gr Dada Ayam is significant; 100 pcs sealer is huge. Report is unreadable without units.

**Evidence:** /waste Qty column has no unit column/cell.

---

### F24: Kartu Stok 'Qty' and 'Saldo' columns have no unit **[LOW]**

- **Category:** Data/UX
- **URL:** `/inventory/ledger`

Kartu Stok Qty uses Indonesian thousands-separator ('24.900' = 24,900) but no unit. Same for Saldo. Every stock movement should be in <number> <unit> for audit.

**Evidence:** Kartu Stok Qty/Saldo cells show only numbers, no unit cell.

---

### F25: Kartu Stok is missing the branch filter **[LOW]**

- **Category:** Functional
- **URL:** `/inventory/ledger`

Stok Saat Ini has a branch filter. Kartu Stok does not — entries from all branches are mixed together with no way to filter. Branch-level audit is impossible from the UI.

**Evidence:** /inventory/ledger snapshot has no branch select; /inventory has branch combobox.

---

### F28: Recipes header says '29 item' but only 15 rows visible — no page indicator **[LOW]**

- **Category:** UX/Consistency
- **URL:** `/recipes`

Header says '29 item' on /recipes. Only 15 rows are visible before pagination, and there is no 'Page 1 of 2' / 'Showing 1-15 of 29' indicator. Users may not realise there are more items on page 2.

**Evidence:** /recipes header '29 item'; visible rows 15; only the 4 navigation buttons shown.

---

### F30: Tambah User PIN field has no client/server minlength; placeholder '1234' could be saved as default **[LOW]**

- **Category:** UX/Security
- **URL:** `/admin/users`

PIN input has maxLength=4, pattern=\d{4}, placeholder='1234', required=false. If the user submits without typing in the field, the form may submit an empty PIN (the React state is the placeholder string '1234' on some browsers/React versions). Even if it's empty, every default user may end up with PIN='1234' if there's a default — a security weakness.

**Evidence:** HTML attributes observed: maxLength=4, pattern='\d{4}', placeholder='1234', required=false. The 'Tampilkan PIN' button confirms a real value is set after save.

---

### F29: No hard delete anywhere — only soft-disable, and the path is broken for users **[INFO]**

- **Category:** Functional
- **URL:** `/admin/users, /admin/branches, /admin/brands, /admin/vouchers, /ingredients`

Every entity I tested offers only 'Nonaktifkan' (deactivate) — Pengguna, Cabang, Merek, Voucher. For Bahan Baku there is a Delete icon button (not exercised). There is no UI path to remove the 'Test User QA' I created (F10).

**Evidence:** 'Pengguna Tidak Dapat Dihapus' dialog blocks deletion; Test User QA is stranded in the user list with no branch.

---

### F31: Notes: did not exercise POS cart end-to-end **[INFO]**

- **Category:** Coverage note
- **URL:** `/pos`

Most items are HABIS (F07), so the cart could not be filled. Buka Shift was not clicked (to minimise state changes). Not exercised: payment flow, receipt printing, shift-close, partial pay, voucher application at POS, modifier-group picking. Recommend a separate pass with a freshly-stocked test branch to exercise these flows.

**Evidence:** Did not click Buka Shift; main dishes are HABIS so the cart could not be filled.

---

### F32: Demo-login user list matches the Pengguna table exactly (11 users) **[INFO]**

- **Category:** Data
- **URL:** `Login screen vs /admin/users`

Login demo buttons list 11 users; /admin/users table shows 11. No mismatch. (Negative finding — initial concern was a mismatch but the data is consistent.)

**Evidence:** 11 entries on each side, identical emails and names.

---

## Summary table

| #   | Severity | Title                                                                                                        | URL                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| F01 | CRITICAL | Matcha Latte COGS calculated at 80x selling price                                                            | `/dashboard`                                                                  |
| F02 | CRITICAL | POS price Rp 0 but Analytics reports non-zero revenue for the same item                                      | `/pos, /dashboard, /analytics`                                                |
| F04 | CRITICAL | Waste events recorded as INBOUND stock in Kartu Stok                                                         | `/inventory/ledger`                                                           |
| F10 | CRITICAL | Creating a new user drops the Cabang (branch) assignment                                                     | `/admin/users`                                                                |
| F03 | HIGH     | Dashboard COGS ≠ Recipes HPP for the same menu item                                                          | `/dashboard vs /recipes`                                                      |
| F05 | HIGH     | Nilai Kerugian (loss value) shows Rp 0 across all waste entries                                              | `/waste`                                                                      |
| F06 | HIGH     | Stock-value widget shows absurd per-unit prices                                                              | `/dashboard`                                                                  |
| F07 | HIGH     | Most POS menu items are HABIS (out of stock) for all branches                                                | `/pos`                                                                        |
| F08 | HIGH     | Dashboard 'Penjualan Hari Ini' = Rp 0 despite many orders today                                              | `/dashboard vs /order-history`                                                |
| F09 | HIGH     | Many Bahan Baku ingredients have HPP = Rp 0                                                                  | `/ingredients`                                                                |
| F11 | HIGH     | Super Admin cannot change Status to Nonaktif — 'Forbidden: insufficient role'                                | `/admin/users`                                                                |
| F27 | HIGH     | Auth/session desync: /admin/branches first paints as 'Branch Admin / Unknown' before settling to Super Admin | `/admin/branches (and other admin pages on first nav)`                        |
| F12 | MEDIUM   | User-action button label mismatches the dialog it opens                                                      | `/admin/users`                                                                |
| F13 | MEDIUM   | Period Control: 'Mei 2026' is Terbuka (open) but today is 23 June 2026                                       | `/period-control`                                                             |
| F14 | MEDIUM   | Recipe detail page missing the menu name heading                                                             | `/recipes/<id>`                                                               |
| F15 | MEDIUM   | Recipe BOM 'Jumlah' column has no unit                                                                       | `/recipes/<id>`                                                               |
| F17 | MEDIUM   | Voucher form: required 'Berlaku Sampai' defaults to 0/0/0/0/0/0 — submit silently no-ops                     | `/admin/vouchers`                                                             |
| F21 | MEDIUM   | Recharts warning: 'width(-1) and height(-1) of chart should be greater than 0'                               | `/dashboard, /analytics`                                                      |
| F26 | MEDIUM   | Tren Penjualan 7 Hari: filter by toDateString() may include/exclude orders based on local TZ                 | `/dashboard`                                                                  |
| F16 | LOW      | Edit Pengguna: PIN placeholder '1234' overlaps the actual value                                              | `/admin/users`                                                                |
| F18 | LOW      | Voucher duplicate-code submission silently no-ops                                                            | `/admin/vouchers`                                                             |
| F19 | LOW      | Print Requests page: description and empty-state copy are in DOM but not rendered                            | `/print-requests`                                                             |
| F20 | LOW      | Three pages have no h1 heading: /yield-tracking, /scm-procurements, /period-control                          | `/yield-tracking, /scm-procurements, /period-control`                         |
| F22 | LOW      | Dialog a11y warning: 'Missing Description or aria-describedby for DialogContent'                             | `/admin/users (and any Radix Dialog)`                                         |
| F23 | LOW      | Waste 'Qty' column has no unit                                                                               | `/waste`                                                                      |
| F24 | LOW      | Kartu Stok 'Qty' and 'Saldo' columns have no unit                                                            | `/inventory/ledger`                                                           |
| F25 | LOW      | Kartu Stok is missing the branch filter                                                                      | `/inventory/ledger`                                                           |
| F28 | LOW      | Recipes header says '29 item' but only 15 rows visible — no page indicator                                   | `/recipes`                                                                    |
| F30 | LOW      | Tambah User PIN field has no client/server minlength; placeholder '1234' could be saved as default           | `/admin/users`                                                                |
| F29 | INFO     | No hard delete anywhere — only soft-disable, and the path is broken for users                                | `/admin/users, /admin/branches, /admin/brands, /admin/vouchers, /ingredients` |
| F31 | INFO     | Notes: did not exercise POS cart end-to-end                                                                  | `/pos`                                                                        |
| F32 | INFO     | Demo-login user list matches the Pengguna table exactly (11 users)                                           | `Login screen vs /admin/users`                                                |

## Testing notes

**What was tested (all reachable routes from the Super Admin sidebar):**

- Login flow + 11 demo accounts
- `/dashboard` (Penjualan Hari Ini, COGS table, stock-value widget, top-moving items)
- `/pos` (Central Warehouse + Omoiyari Darmo Permai)
- `/order-history`
- `/print-requests`
- `/cancel-requests`
- `/inventory` + `/inventory/ledger`
- `/stock-opname`
- `/waste` + `/waste/broken-stock`
- `/scm-procurements`
- `/supplier-deliveries`
- `/scm-transfers`
- `/yield-tracking`
- `/ingredients`
- `/recipes` + 2 recipe detail pages (REC-020, REC-014)
- `/modifier-groups`
- `/admin/users` (Tambah User form, Edit dialog, delete-attempt dialog)
- `/admin/branches` (8 branches)
- `/admin/brands` (1 brand)
- `/admin/vouchers` (Tambah + Nonaktifkan)
- `/finance`
- `/analytics`
- `/period-control`
- `/admin/system-logs` (only sidebar presence checked)
- `/admin` (settings)

**Mutations performed:**

- Created 1 user (`Test User QA / test.qa@omoiyari.net` / Branch Admin / Omoiyari Wiyung). The branch assignment was dropped (F10). The user is stranded in the system with no UI path to remove it.
- Created 1 voucher (`TESTQA01 / 5%` with validUntil 2026-12-31). Soft-disabled (status now Nonaktif).
- Did not open a POS shift, did not complete a sale.

**What was NOT tested:**

- POS payment flow, receipt printing, shift-close, partial pay, voucher application at POS, modifier-group picking on a menu item (blocked by F07 — most items HABIS).
- Stock Opname creation flow.
- Pengadaan full lifecycle (Draft → Lunas).
- Supplier Deliveries.
- SCM Transfers.
- Yield Tracking input form.
- Cancel Request approve/reject buttons.
- Real PIN login (only used the demo email-login buttons).
- The 'Hapus' button on a recipe detail page (it appears; clicking it would delete a recipe — not exercised).

**Data saved for review:**

- `/tmp/dogfood-omoiyari/data/findings.json` — this report's findings, machine-readable.
- `/tmp/dogfood-omoiyari/data/dashboard_cogs_issues.json` — Dashboard COGS vs Recipes HPP comparison.
- `/tmp/dogfood-omoiyari/data/recipes_hpp.json` — first 15 recipes with Harga Dasar + HPP.
- `/tmp/dogfood-omoiyari/data/{index,dashboard,pos,finance,inventory,users,recipes}.js` — the static bundles for the SPA, useful for further code review.
