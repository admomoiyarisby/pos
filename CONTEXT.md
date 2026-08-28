# Omoiyari POS

A point-of-sale and supply-chain management system for a restaurant group with multiple branches (outlets and a central kitchen).

## Language

**Order**:
A customer transaction recorded at a branch, consisting of one or more order items, optionally with modifiers, exclusions, and voucher discounts.
_Avoid_: Transaction, sale

**Receipt (Struk)**:
A printed document generated after an order is paid, confirming the transaction. Always shows Kode Order and Pelanggan.
_Avoid_: Invoice (when referring to customer receipts; invoice is reserved for SCM B2B documents)

**Bill (Tagihan)**:
A pre-checkout printed document for dine-in orders, generated before payment. Shows Kode Order (from the external platform when applicable, otherwise "-") and Pelanggan (customer name or "-").
_Avoid_: Invoice, receipt

**Kode Order**:
For delivery channels (Gofood/Grabfood/ShopeeFood): the external platform order code. For dine-in: fallback to the internal order ID (first 8 chars). Always displayed on receipts and bills.
_Avoid_: Transaction ID, order number

**Pelanggan**:
The customer's name as entered at the POS. Always displayed on receipts and bills. Falls back to "-" when not provided.

**Recipe**:
A product that can be sold. Recipes may have a Bill of Materials (BOM) — a list of ingredients with quantities. Recipes may also reference child recipes (for bundles/packages) and optional modifiers.
_Avoid_: Menu item, SKU, product

**Recipe Status**:
The lifecycle of a Recipe, one of three states. `Active` — sellable, listed normally. `Inactive` — deactivated; reversible, still listed (with a badge) and reactivatable. `Deleted` — a soft-delete tombstone: the row and all history (orders, COGS, audit) are preserved, but the recipe is invisible to the entire UI and restorable only via database. Deletion is `super_admin`-only and UI-irreversible; reactivation is available to `super_admin` and `admin_pusat`.
_Avoid_: disabled, archived, removed

**Ingredient**:
A raw material, semi-finished good (SFG), or finished good (FG) tracked in inventory. Ingredients have an `averageCost` that feeds into recipe COGS calculations.
_Avoid_: Raw material, stock item, component

**Ingredient Resolver**:
A module that traverses a recipe's BOM — including child recipes (bundles) and modifier ingredients — to produce a flat list of ingredient deltas with signed quantities (positive = consumed, negative = excluded/restored). Used by the Order Intake module for stock checking, COGS calculation, inventory deduction, and void restoration.
_Avoid_: BOM resolver, ingredient flattener, stock calculator

**Production (Produksi)**:
The act of transforming inventory at the Central Kitchen: a set of ingredients is consumed (Barang Keluar / "out") and a set of ingredients is created (Barang Dihasilkan / "produced"). A production record **documents and applies** the transformation: recording it deducts the out items from the branch's stock and adds the produced items, each written to the stock ledger (Kartu Stok). Cancelling the record reverses the mutation. It does NOT recompute HPP or yield; produced-item cost is set manually on the ingredient master.
_Avoid_: Yield conversion, BOM, manufacturing order

**Barang Keluar (out)**:
An ingredient consumed by a production record; recording the record deducts its stock at the record's branch.
_Avoid_: source, input, raw

**Barang Dihasilkan (produced)**:
An ingredient created by a production record; recording the record adds its stock at the record's branch.
_Avoid_: target, output, finished

**Modifier Group (Grup Modifier)**:
A named, ordered collection of Modifiers (options) with a min/max selection constraint, linked to one or more Recipes so they can be offered at the POS. The relationship is managed through the "Menu Terkait" (related recipes) linking UI; the same group can be reused across multiple Recipes.
_Avoid_: Option group, add-on group, modifier set

**Modifier**:
An optional add-on or exclusion attached to an order item. A modifier is exactly one of three **kinds** — `text` (a priced label, no stock/COGS link), `ingredient` (links an ingredient with a quantity, add-on BOM), or `recipe` (links another recipe with a quantity, add-on BOM). Ingredient/recipe modifiers are stock-checked and COGS'd at transaction time. Exclusion (`isExclusion`, via `recipeModifierExclusions`) is a modifier-wide toggle that works for all three kinds.
_Avoid_: Add-on, option, up-sell

**Shift**:
A cashier's work session at a branch. Orders are attributed to the active shift. Shifts track cash float, actual cash, and expected cash for reconciliation.
_Avoid_: Session, work period

**Branch**:
A physical location where orders are taken and inventory is stored. Branches can be of type `Central` (warehouse/kitchen) or `Outlet`.
_Avoid_: Store, location, outlet (when referring to the general concept)

**Stock Opname (SO)**:
A physical inventory verification process where actual stock is counted and compared against system records. The SO is "triggered" by a supervisor (Area Manager or Admin Pusat), then "submitted" by the counter with physical counts. If approved, the system inventory is adjusted to match the physical count. SO can be "Blind" (counter cannot see system stock) or "See-Through" (counter can see system stock and variance).
_Avoid_: Stock audit, physical count, inventory check

**Variance**:
The difference between physical stock (what was actually counted) and system stock (what the system believes is on hand). Calculated as `physicalStock - systemStock`. Positive means surplus, negative means shortage.
_Avoid_: Discrepancy, difference, selisih (when used as a technical term)

**System Stock (SO context)**:
The quantity the system believed was on hand at the moment the SO was triggered. Frozen at trigger time, used only for display/investigation purposes. NOT used for inventory adjustment calculations — physical stock is the source of truth upon approval.
_Avoid_: Expected stock, digital stock

**Procurement (Pengadaan)**:
A **Central→Branch** restocking process — a subtype of **Stock Transfer** — modeled as a single document (`scm_procurements`) with a 10-state Finite State Machine. Replaces the older 3-document model of separate PR, SJ (Surat Jalan / delivery note), and SCM Invoice. A procurement walks through Draft → Pending → UnderReview → InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished, with terminal states Rejected and Cancelled. See ADR 0002. The Central→Branch subtype is why the source side is owned by `admin_pusat` and the destination side by `branch_admin`.
_Avoid_: PR, purchase requisition, restock request, supply order (the older terms referred to individual documents within the old 3-document model)

**Procurement Transition**:
A state change on a procurement, triggered by an event from a specific actor. Defined in the FSM transition table (`scm-fsm.ts`). Each transition has a target state, an allowed-actor list, and a list of effect handlers. Transitions are atomic — the state update, all effects, and the audit log row commit in a single transaction. In contrast, **item-level updates** (e.g., CA editing `readyQuantity` during UnderReview) are NOT transitions; they are in-state mutations recorded as `item-update` events.
_Avoid_: state change, status update

**Admin Pusat (CA / Central Admin)**:
The central warehouse's administrator role. Has authority over SCM procurement: reviews PRs, ships stock, marks delivered, generates invoices, marks paid. The shorthand "CA" appears in lesson 0002 and ADR 0002 for brevity; the canonical term in the codebase, CONTEXT.md, and the sidebar is "Admin Pusat". The DB role is `admin_pusat`.
_Avoid_: Central admin, central kitchen admin (different role), warehouse manager

**Branch Admin (BA)**:
The destination branch's administrator role. Owns the procurement lifecycle from the branch side: creates PRs, fills receiving forms, views invoice preview, can withdraw a Pending procurement.
_Avoid_: store manager, outlet admin (when referring to the role)

**Cabang Pengirim (Sender Branch Admin)**:
The `branch_admin` at the **sender** branch (`fromBranchId`) in a Mutasi Stok transfer. Responsible for creating the Surat Jalan, editing items, and shipping (SuratJalanDraft → Approved → InTransit). Not to be confused with the Receiver Branch Admin — they never touch receiving or payment.
_Avoid_: sender, pengirim (when used as a standalone role name)

**Cabang Penerima (Receiver Branch Admin)**:
The `branch_admin` at the **receiver** branch (`toBranchId`) in a Mutasi Stok transfer. Responsible for confirming delivery, reviewing received items, and marking paid (InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished). Not to be confused with the Sender Branch Admin — they never create or ship.
_Avoid_: receiver, penerima (when used as a standalone role name)

**Stock Transfer (Transfer Stok)**:
The parent concept for any movement of stock from one branch to another. Has two concrete subtypes: **Procurement (Pengadaan)** (Central→Branch) and **Mutasi Stok** (Branch→Branch). Both subtypes share the same FSM _shape_ — one root document, item-level review, an invoice snapshot at the end, and an audit log — but they differ in actors (Admin Pusat vs Sender Branch on the source side), state semantics (which states exist and who owns each transition), and pricing. Two parallel root tables (`scm_procurements`, `scm_transfers`) — see Q1 decision.
_Avoid_: stock movement, transfer (alone), perpindahan stok

**Mutasi Stok (Stock Transfer, Branch→Branch)**:
A **Branch→Branch** restocking process — a subtype of **Stock Transfer**. The **Sender Branch** (the branch that agreed to give up stock) creates the Surat Jalan; the **Area Manager** of the Sender+Receiver pair approves; the **Receiver Branch** confirms delivery, reviews items per line, and the Invoice is generated from what was actually received. Each item carries a `unitPrice` snapshotted from the sender's `averageCost` at SJ creation; the Receiver pays the Sender. Sender Branch physically ships (marks InTransit); the Receiver Branch marks Delivered when goods physically arrive. Area Manager is bounded to transfers where both endpoints fall in their `assignedBranches`. 10-state FSM: `SuratJalanDraft → PendingAMReview → Approved → InTransit → Delivered → ReviewingSJ → WaitingForPayment → Finished`, terminals `Rejected` and `Cancelled`.
_Avoid_: transfer antar cabang (use as the colloquial Indonesian term only, not in canonical docs), mutasi barang

**Pending Review Inventory**:
A ledger bucket (`pending_review_inventory`) for stock that has been delivered to a branch but not yet received by the branch admin. Distinct from `in_transit_inventory` (stock in transit) and the branch's main `inventory` (stock available for use). When BA completes the receiving review, the qty moves into branch main inventory (received) or `waste_entries` (rejected). Introduced in ADR 0002 §sub-decision.
_Avoid_: receiving inventory, dock stock, in-branch staging

**In-Transit Inventory**:
The shared `in_transit_inventory` ledger used by three flows: (1) legacy delivery-note flow (with `deliveryNoteId` set), (2) Pengadaan (with `scmProcurementId` set, per ADR 0002), and (3) Mutasi Stok (with `scmTransferId` set). Stock that has left the source branch but not yet reached the destination. Exactly one of the three FK columns is set per row (a check constraint enforces this).
_Avoid_: transit stock, in-transit ledger

**Waste (Waste Entry)**:
A record of stock loss at a branch for either an ingredient or a finished menu (recipe) — exactly one of `ingredientId` / `recipeId` is set — in one of four categories — `Beban Makan` (staff meal allowance), `Biaya Operasional` (operational expense), `Spoiled` (spoiled/broken, including spilled/dropped glasses such as iced tea), or `Denda` (employee fine). Recording deducts the quantity from the branch's ingredient inventory (`inventory`) or recipe inventory (`recipeInventory`) and writes an OUT row to the stock ledger (Kartu Stok) on the matching column (`stockLedger.ingredientId` or `stockLedger.recipeId`); a `Biaya Operasional` entry also creates an operational expense. An entry is `Active` until cancelled. `Spoiled` is not split by target — the target type (Bahan vs Menu) distinguishes ingredient spoilage from menu spoilage.

Menu waste has two modes (ADR 0013): **Porsi jadi** deducts the finished-porsi shelf (`recipeInventory`) only; **Bahan (BOM)** deducts a user-chosen subset of the recipe's flat per-porsi BOM ingredients (resolved with the same math as POS order intake) as one entry per ingredient, tagged `Waste BOM <recipe>` in notes, leaving the porsi shelf untouched.
_Avoid_: shrinkage, loss, buang

**Waste Cancellation (Pembatalan Waste)**:
Setting a waste entry's status to `Cancelled` — allowed only for `super_admin` (any branch) and `area_manager` (assigned branches only), with a required reason. The stock effect is reversed: the quantity is restored to the same inventory surface it was deducted from (`inventory` for ingredients, `recipeInventory` for recipes) with an IN row on the same stock ledger reference. The cancelled entry stays visible with a badge, stops counting toward loss totals, and can no longer be edited or investigated. Mirrors Production cancellation (ADR 0012).
_Avoid_: waste void, delete waste

**Recipe Inventory**:
Finished-good stock per branch (`recipeInventory`): the quantity of a recipe's plated units held at a branch (e.g., ready iced teas at an outlet). Upserted-from-0 when first stocked or first wasted; negative allowed with warning, consistent with ingredient inventory / POS / Production (ADR 0012). Movements are written to Kartu Stok via `stockLedger.recipeId` (production IN via `assignRecipeStock`, waste OUT, cancellation IN). Not to be confused with `inventory` (ingredient stock) or BOM ingredients.
_Avoid_: menu stock (ambiguous), finished-goods inventory (when referring to the ingredient FG skuType)

**Mutasi Unit Price**:
The price per unit (in IDR) that the **Receiver Branch** pays the **Sender Branch** for an ingredient in a specific Mutasi transfer. Snapshotted from `ingredients.averageCost` at the **sender's** branch (i.e., the `inventory.averageCost` at the `fromBranchId` location) at item-creation time. Frozen on the item row — subsequent changes to `averageCost` do not affect existing transfers. The Mutasi invoice is generated as `receivedQuantity * unitPrice`, summing to a `totalAmount` paid by the receiver to the sender. Mirrors Pengadaan's pricing model (ADR 0003) but the snapshot source is the _sender_ branch's inventory, not a Central warehouse.
_Avoid_: transfer cost, mutasi cost

**Procurement Unit Price**:
The price per unit (in IDR) that the destination branch pays the central warehouse for an ingredient in a specific procurement. Snapshotted from `ingredients.averageCost` at procurement-item-creation time (in `createProcurement`). The price is frozen on the item row — subsequent changes to `averageCost` do not affect existing procurements. The CA review form shows the price + per-line subtotal + grand subtotal (read-only); the BA's request form shows the price as a transparency aid (also read-only); the invoice is generated as `receivedQuantity * unitPrice`. The CA cannot override the price in the current flow — if a different price is needed, CA adjusts `ingredients.averageCost` first. See ADR 0003.
_Avoid_: cost, harga, procurement cost (reserved for the per-recipe manufacturing cost tracked in COGS)

**Recipe Category**:
A grouping label for recipes (e.g., Makanan, Minuman, Snack). Categories are mutable — stored in the `categories` table (ADR 0007), referenced by `recipes.categoryId`. Created and deleted by `super_admin` / `admin_pusat`. Deleting a category requires a destination category for orphaned recipes.
_Avoid_: hardcoded enum (legacy), menu group

**Table Search (Pencarian Tabel)**:
The free-text, fuzzy, URL-persisted query box on a `DataTable` list page (e.g. `/categories`, `/modifier-groups`). Distinct from a Filter — it matches across row text with typo tolerance and stores its value in `?search=` so it survives reload and is shareable. Client pages use Fuse.js; server-backed searches use Postgres `pg_trgm` (ADR 0008).
_Avoid_: search box (too generic), query, find

**Filter (Filter)**:
Structured narrowing of a list via dedicated URL params — e.g. `status`, `negative`, `noInvestigation` — as opposed to the free-text Table Search. A Filter selects a known dimension; a Table Search matches arbitrary text.
_Avoid_: search (when referring to the free-text box), query

**Fuzzy Search**:
Typo-tolerant matching used by Table Search. Client side: Fuse.js (threshold `0.3`, `ignoreLocation`). Server side: Postgres `pg_trgm` `similarity()` > `0.3`, re-ranked by score (ADR 0008). Contrast with exact substring/ILIKE matching.
_Avoid_: search (bare), contains

**Unsaved Draft (Draft Belum Tersimpan)**:
A screen where the user enters a large body of data that exists only in client state until an explicit submit, and that data is **costly or impossible to reconstruct** if lost (e.g. physical stock counts, hand-keyed line items before the first server save). A screen qualifies only if it meets both tests: (1) bulk client-only entry — many rows or a large form held only in component state until submit, and (2) non-reconstructable — the data cannot be re-fetched or re-derived (physical counts, hand observations) the way a procurement draft's quantities could be re-entered from a paper list. Qualifying screens get client-side persistence (localStorage); screens where each edit is already server-backed (e.g. procurement detail review, where `readyQuantity` persists per-keystroke) or where the entry is a single quick record (e.g. waste entry, manual adjustment) do not.
_Avoid_: long-time-needed process, autosave, draft (bare — "Draft" is already a Procurement FSM state; reusing it blurs the server-side state with the client-side concept)
