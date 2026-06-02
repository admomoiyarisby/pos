# Omoiyari POS

A point-of-sale and supply-chain management system for a restaurant group with multiple branches (outlets and a central kitchen).

## Language

**Order**:
A customer transaction recorded at a branch, consisting of one or more order items, optionally with modifiers, exclusions, and voucher discounts.
_Avoid_: Transaction, sale, receipt

**Recipe**:
A product that can be sold. Recipes may have a Bill of Materials (BOM) — a list of ingredients with quantities. Recipes may also reference child recipes (for bundles/packages) and optional modifiers.
_Avoid_: Menu item, SKU, product

**Ingredient**:
A raw material, semi-finished good (SFG), or finished good (FG) tracked in inventory. Ingredients have an `averageCost` that feeds into recipe COGS calculations.
_Avoid_: Raw material, stock item, component

**Ingredient Resolver**:
A module that traverses a recipe's BOM — including child recipes (bundles) and modifier ingredients — to produce a flat list of ingredient deltas with signed quantities (positive = consumed, negative = excluded/restored). Used by the Order Intake module for stock checking, COGS calculation, inventory deduction, and void restoration.
_Avoid_: BOM resolver, ingredient flattener, stock calculator

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
