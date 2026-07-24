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

**Ingredient**:
A raw material, semi-finished good (SFG), or finished good (FG) tracked in inventory. Ingredients have an `averageCost` that feeds into recipe COGS calculations.
_Avoid_: Raw material, stock item, component

**Ingredient Resolver**:
A module that traverses a recipe's BOM — including child recipes (bundles) and modifier ingredients — to produce a flat list of ingredient deltas with signed quantities (positive = consumed, negative = excluded/restored). Used by the Order Intake module for stock checking, COGS calculation, inventory deduction, and void restoration.
_Avoid_: BOM resolver, ingredient flattener, stock calculator

**Modifier Group (Grup Modifier)**:
A named, ordered collection of Modifiers (options) with a min/max selection constraint, linked to one or more Recipes so they can be offered at the POS. The relationship is managed through the "Menu Terkait" (related recipes) linking UI; the same group can be reused across multiple Recipes.
_Avoid_: Option group, add-on group, modifier set

**Modifier**:
An optional add-on or exclusion attached to an order item. A modifier can add ingredients (add-on BOM) or remove ingredients (exclusion, via `recipeModifierExclusions`).
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

**Mutasi Unit Price**:
The price per unit (in IDR) that the **Receiver Branch** pays the **Sender Branch** for an ingredient in a specific Mutasi transfer. Snapshotted from `ingredients.averageCost` at the **sender's** branch (i.e., the `inventory.averageCost` at the `fromBranchId` location) at item-creation time. Frozen on the item row — subsequent changes to `averageCost` do not affect existing transfers. The Mutasi invoice is generated as `receivedQuantity * unitPrice`, summing to a `totalAmount` paid by the receiver to the sender. Mirrors Pengadaan's pricing model (ADR 0003) but the snapshot source is the _sender_ branch's inventory, not a Central warehouse.
_Avoid_: transfer cost, mutasi cost

**Procurement Unit Price**:
The price per unit (in IDR) that the destination branch pays the central warehouse for an ingredient in a specific procurement. Snapshotted from `ingredients.averageCost` at procurement-item-creation time (in `createProcurement`). The price is frozen on the item row — subsequent changes to `averageCost` do not affect existing procurements. The CA review form shows the price + per-line subtotal + grand subtotal (read-only); the BA's request form shows the price as a transparency aid (also read-only); the invoice is generated as `receivedQuantity * unitPrice`. The CA cannot override the price in the current flow — if a different price is needed, CA adjusts `ingredients.averageCost` first. See ADR 0003.
_Avoid_: cost, harga, procurement cost (reserved for the per-recipe manufacturing cost tracked in COGS)

**Recipe Category**:
A grouping label for recipes (e.g., Makanan, Minuman, Snack). Categories are mutable — stored in the `categories` table (ADR 0007), referenced by `recipes.categoryId`. Created and deleted by `super_admin` / `admin_pusat`. Deleting a category requires a destination category for orphaned recipes.
_Avoid_: hardcoded enum (legacy), menu group
