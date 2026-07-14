# Notes → Data Needs Analysis (Omoiyari POS)

Scope: only the issues that require **data / schema** work. Routing, permission
gating, UI, and notification _logic_ are out of scope here (tracked separately).

Verification method: cross-read `src/db/schema.ts`, seed data
(`src/lib/seed/seed-data.ts`), server modules (`waste.ts`, `yield.ts`,
`document-codes.ts`, `scm-transfer-notifications.ts`), and the two workbooks
(`docs/excel/File Omoiyari Pembukuan TENANT ...` and `Data Penjualan ...`).

Legend:
EXISTS = data model already supports it (no schema change)
GAP = genuinely missing data/table/column
RECON = exists but must be reconciled (format/naming)

════════════════════════════════════════════════════════════

1. INVENTORY — Cabang vs Pusat item differentiation (note K)
   ════════════════════════════════════════════════════════════
   Status: GAP (real schema change)

Current model:

- `ingredients` is GLOBAL (no per-branch ownership flag).
- `inventory` is per (branchId, ingredientId) — stock, not ownership.
- `branchTypeEnum` (Central / Outlet) exists on `branches`.
- No way to say "this ingredient is Pusat-only" vs "Cabang-only" vs "shared".

Rule from note: Pusat = superset; Cabang ⊂ Pusat. Insert menu needs All / Cabang / Pusat.

Proposed data change (one of):
(a) Add enum + column on ingredients:
export const ingredientScopeEnum = pgEnum("ingredient_scope",
["All", "Cabang", "Pusat"]);
scope: ingredientScopeEnum("scope").notNull().default("All"),
then filter the insert/visibility list by scope vs branch.type.
(b) Junction ingredient_branch_visibility(ingredientId, branchId) like
recipe_branches — more flexible but heavier; not needed for a 3-way split.

RECOMMENDATION: (a) single column. Seed: Pusat-only items → "Pusat",
branch-stocked → "Cabang", everything else → "All".

Grounding: branch types live in `branches.type` (Central/Outlet).

════════════════════════════════════════════════════════════ 2. CENTRAL KITCHEN — manual batch, NO auto-convert (note V)
════════════════════════════════════════════════════════════
Status: GAP (behavior change + new batch entity)

Current model (`yield.ts:createYieldConversion`):

- On create it AUTO-WRITES ledger: deducts each source (OUT) and adds target
  (IN), updates `inventory`, updates `ingredients.averageCost`, and rolls up
  recipe costs. This is exactly the "auto convert" the note forbids.
- `yieldConversions` + `yieldConversionSources` are the only production records.
- Role `central_kitchen` already exists; `createYieldConversion` gated to
  super_admin + central_kitchen.

Requirement: per batch, manually OUT raw/SFG and manually IN finished goods.
Nothing automatic.

Proposed data change:
NEW TABLE `centralKitchenBatches`:
id, branchId (Central), batchDate (date), producedById (users.id),
status enum (Draft | Confirmed), notes, createdAt
NEW TABLE `centralKitchenBatchItems`:
id, batchId, ingredientId, direction enum (IN | OUT),
quantity (real), createdAt

- Insert rows as a draft; confirm writes the ledger/inventory (explicit, not
  on insert). This preserves auditability of "what left / what came in".
- Keep `yieldConversions` for historical SFG conversions but STOP auto ledger
  writes there, OR make yield only used as a recipe/BOM reference, not a live
  movement.

Note: existing auto-convert logic in createYieldConversion must be split —
move the ledger/inventory writes into a separate confirmBatch() so the "manual
per batch" rule holds.

════════════════════════════════════════════════════════════ 3. STOCK OPNAME — "Nasi" item + reverse to Beras (note T)
════════════════════════════════════════════════════════════
Status: PARTIAL-GAP (Nasi exists as recipe; reverse-flow missing)

Current model:

- `recipes` already has:
  rec009 "nasi putih" (basePrice 10000, isSubRecipe:false)
  BOM: ing023 Beras 67.5, ing088 Beras Ketan 7.5, ing014 Air 117,
  ing089 Cuka Nasi 1.25, ing102 Mangkok soup 300ml 1
  rec028 "Nasi Staff" (basePrice 1515) — same BOM minus the mangkok.
- `stockOpnameItems` references `ingredients`, NOT recipes. So you cannot
  currently opname "Nasi" as a physical line — there is NO "Nasi" ingredient,
  only a recipe. Bowls reference Beras directly, not a Nasi recipe.
- `yieldConversions` only goes source→target (forward). No reverse mapping
  Nasi → Beras.

Requirement: opname Nasi physically; if variance, convert back to Beras/etc.
into live inventory + stock card.

Proposed data change:
(a) Add ingredient "Nasi Putih" (skuType FG or SFG) so it can appear in
`stockOpnameItems.ingredientId`. Keep rec009 as the recipe that _consumes_
the Nasi ingredient (or keep both — recipe for costing, ingredient for opname).
(b) Add a reverse-conversion rule so a Nasi variance flows to its BOM
ingredients. Options: - Reuse `yieldConversions` with a flag reverseEligible / or a new
`nasiConversions` table mapping 1 Nasi → {Beras 72.9, Beras Ketan 8.1,
Air 117, Cuka Nasi 1.25, Mangkok 1} (matches Audit Inventory rows 58–62). - On realize (note W), if Nasi variance != 0, write stockLedger OUT/IN
for Nasi AND the proportional Beras/Beras Ketan/Air/Cuka Nasi lines.

Grounding (Audit Inventory rows 58–62, exact):
nasi putih → Beras 72.9 gr, Beras Ketan 8.1 gr, Air 117 gr, Cuka Nasi 1.25 gr,
Mangkok soup 300ml 1 pcs (per 1 porsi / 23 porsi → 1676.7 gr beras total).

Note: the seed rec009 uses Beras 67.5 while the sheet uses 72.9 — RECONCILE the
BOM quantity (sheet is the source of truth per note).

════════════════════════════════════════════════════════════ 4. BARANG RUSAK — move to Finance, admin_pusat/super_admin (note Y)
════════════════════════════════════════════════════════════
Status: EXISTS (backing data present; only routing/permission change)

Current model (`waste.ts:getBrokenStock`):

- Broken stock = `wasteEntries` WHERE category = "Biaya Operasional", joined to
  `operationalExpenses` (via wasteEntryId) for amount.
- Route `/waste/broken-stock` already exists.
- No dedicated `broken_stock` table — it's filtered wasteEntries.

Conclusion: NO schema change. Move route under Finance and gate to
admin_pusat + super_admin. If a dedicated table is desired for clarity, add
`brokenStockEntries(branchId, ingredientId, quantity, reason, valuation, date)`
but it is optional — current model is sufficient.

════════════════════════════════════════════════════════════ 5. INVOICE / DOC CODES — branch code format (notes C, M)
════════════════════════════════════════════════════════════
Status: RECON (generator fine; branch code strings differ)

Current model (`document-codes.ts`):

- `generateDocumentCode(prefix, branchCode, date)` → "INV/TGL/060726/01".
  Already matches the requested format exactly. `documentCodeSequences`
  stores (prefix, branchCode, date, lastSerial) and resets daily.
- Called for INV/PR/MT/DN/SJ via the same generator → all codes carry branch
  - date, satisfying note M.

Mismatch:

- Note lists 3-letter codes: TGL, MLY, WYG, DRP, JBG, SWK, RKT, TS.
- Seed `BRANCH_CODES` = "WYG-01","DRM-01","TGL-01","MLY-01","JMB-01","SWL-01",
  "PCG-01". (Also note's "DRP" = Darmo Permai but seed uses "DRM"; note's
  "JBG" = Jambangan; note's "TS" = Tegalsari — not in seed at all.)

Decision needed: standardize branchCode string. Either change seed to 3-letter
or pass 3-letter codes to the generator. The generator is agnostic — just align
the stored `branches.code` values with what the note wants.

════════════════════════════════════════════════════════════ 6. FINANCE — manual GAJI / LISTRIK / SEWA entries (notes E, H)
════════════════════════════════════════════════════════════
Status: EXISTS (generic table; optional category enum)

Current model:

- `operationalExpenses` (branchId, category TEXT, amount, date, notes,
  submittedBy) — can already store gaji/listrik/air/sewa as free-text category.
- `manualRevenues` + `manualRevenueBrandBreakdowns` — manual omzet per branch.
- `channelRevenues` (branchId, date, channel, amount) — manual omzet per day per
  channel (TikTok already in enum). This is the "admin_pusat enters omzet per
  day per channel" table from note H.
- HPP per bahan = `ingredients.averageCost`.

Proposed (optional, recommended): make `operationalExpenses.category` a controlled
enum/lookup (GAJI, LISTRIK_AIR, SEWA, LAINNYA) so the finance view can group,
instead of free text. NOT required for function.

Grounding (Pencatatan Manual sheet):
Biaya Operasional rows: Galon 6000, LPG 20000, Minyak 1L 17000, Minyak 2L 34000,
PEX 15 9000, PEX 20 9500.
Staff-meal HPP: Chicken Katsu Don 4096, Karage Don 6370, Hot Honey Karage 7010,
Nasi 1515, Telor 1750. (rec028 "Nasi Staff" basePrice already 1515 ✓.)

════════════════════════════════════════════════════════════
SUMMARY — what actually needs data work
════════════════════════════════════════════════════════════
MUST (schema/migration):

1. ingredients.scope enum + column (note K)
2. centralKitchenBatches + centralKitchenBatchItems (note V) + split yield auto-write
3. ingredient "Nasi Putih" (FG/SFG) + reverse-conversion to Beras (note T)
4. branch code reconciliation TGL/MLY/... vs TGL-01 (notes C, M)

SHOULD (optional, improves grouping): 5. operationalExpenses.category → controlled enum (notes E, H)

DOES NOT need schema (data already exists; routing/permission/UI only):

- Broken stock (note Y) — filtered wasteEntries + operationalExpenses
- Manual finance entries (notes E, H) — operationalExpenses / channelRevenues
- Stock opname approval/realize (notes A, W) — status + realizedBy/realizedAt
- Employee penalty / denda (note S) — employeePenalties already exists
- Staff meal Rp 0 (note P) — isStaffMeal flag + price 0 logic
- Login name list (note Q) — branchStaffNames + branches.pin already exist
- Notifications urgent + bell (note O) — priority column + type already exist
- Price hiding for branch_admin (note N) — view/serializer rule, no column
- TikTok channel (note J) — enum already has TikTok; update hardcoded 4-channel
  array in seed-data.ts CHANNELS
- PDF exports (notes R, U) — print endpoints, data already present
- Sales CRUD cascade (note L) — reuse order-completion ledger effect
- Audit Inventory live view (note F) — derived query over recipe_ingredients/
  inventory, not a stored table
