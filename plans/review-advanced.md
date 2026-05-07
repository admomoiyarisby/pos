# Comprehensive Review & Implementation Plan — Omoiyari POS & Inventory System

## Document Reference

- **FRD:** `plans/Functional Requirement Document.md`
- **Old Prototype:** `../omoiyari_pos/src/App.tsx`

---

## Executive Summary

After cross-referencing the entire FRD against the current codebase, **approximately 60% of features are either fully implemented or structurally present** (schema + server functions exist). The remaining **40% consists of gaps** ranging from minor UI wiring to major missing business logic.

### What's Already Done Well

- Complete database schema (tables, relations, enums, indexes)
- Core POS flow (menu, cart, checkout, receipt print)
- Shift management (open/close)
- Full SCM document flow (PR → PO → SJ → Invoice)
- Stock opname with blind mode and variance calculation
- Auth system with RBAC and PIN login
- System logs and audit logs infrastructure
- Notification system (bell + dropdown)
- Approval server functions for print requests
- Waste categorization (3 categories enforced)
- BOM cost roll-up functions (exist but **never called**)

### Critical Gaps

1. **BOM Cost Roll-Up** — functions exist but never triggered
2. **COGS Snapshot** — column exists but always 0
3. **Cancel/Print Request UI** — pages are hardcoded mocks
4. **Pagination** — no server-side pagination anywhere
5. **Smart Reordering** — ROP/ROQ exist but never auto-calculated
6. **Negative Stock Check** before period close
7. **Session Restriction** — 1 device per cashier
8. **Modifier BOM** — modifiers don't deduct inventory
9. **Exclusion Restore** — excluded ingredients not restored
10. **Historical COGS Lock** — past transactions affected by HPP changes

---

## Module 1: Master Data

### 1.1 BOM Cost Roll-Up — CRITICAL

**Status:** Functions exist in `src/lib/server/cost-rollup.ts` but **never invoked**.

**What exists:**

```ts
// src/lib/server/cost-rollup.ts
export async function recalculateRecipeCostsForIngredient(ingredientId: string) { ... }
export async function recalculateRecipeCosts(recipeIds: string[]) { ... }
export async function recalculateAllRecipeCosts() { ... }
```

**What's missing:** Wire these functions into every mutation that changes ingredient cost.

**Implementation:**

Add `import { recalculateRecipeCostsForIngredient } from "./cost-rollup"` to these files and call it after cost changes:

| File                                    | Function                 | When to trigger                                |
| --------------------------------------- | ------------------------ | ---------------------------------------------- |
| `src/lib/server/ingredients.ts`         | `updateIngredient`       | After `averageCost` is updated                 |
| `src/lib/server/supplier-deliveries.ts` | `createSupplierDelivery` | After delivery is recorded                     |
| `src/lib/server/scm.ts`                 | `receiveDeliveryNote`    | After receiving items (if cost changes)        |
| `src/lib/server/yield.ts`               | `createYieldConversion`  | After yield conversion (cost per unit changes) |

**Also add a "Recalculate HPP" button** on the recipes page for Super Admin to manually trigger `recalculateAllRecipeCosts()`.

---

### 1.2 Recipe Total COGS Display

**Status:** `totalCogs` column exists in `recipes` table but is **not displayed** in the UI.

**Implementation:**

In `src/routes/_layout/recipes/index.tsx`, add a column:

```tsx
{
  key: "totalCogs",
  header: "HPP Total",
  align: "right",
  sortable: true,
  render: (r) => `Rp ${r.totalCogs.toLocaleString("id-ID")}`,
}
```

In `src/routes/_layout/recipes/$recipeId.tsx`, display the HPP breakdown:

```tsx
<div className="rounded-md bg-muted p-3">
  <p className="text-sm font-medium">HPP Total</p>
  <p className="text-lg font-bold">Rp {recipe.totalCogs.toLocaleString("id-ID")}</p>
  <p className="text-xs text-muted-foreground">
    Margin: {(((recipe.basePrice - recipe.totalCogs) / recipe.basePrice) * 100).toFixed(1)}%
  </p>
</div>
```

**Alert if HPP > 40% of basePrice** (FRD §6.1):

```tsx
{recipe.totalCogs / recipe.basePrice > 0.4 && (
  <Badge variant="destructive">HPP > 40%!</Badge>
)}
```

---

### 1.3 SKU Type Enforcement

**Status:** `skuType` enum exists (`RM`, `SFG`, `FG`) but UI doesn't show or enforce it.

**Implementation:**

1. Add `skuType` to ingredient form (create/edit)
2. Add `skuType` filter to ingredients list
3. In recipe creation, only allow `FG` and `SFG` ingredients as recipe outputs
4. In recipe ingredients (BOM), only allow `RM` and `SFG` as inputs
5. Display SKU type badge in ingredient list:
   ```tsx
   <Badge
     variant={ing.skuType === "RM" ? "default" : ing.skuType === "SFG" ? "warning" : "success"}
   >
     {ing.skuType}
   </Badge>
   ```

---

### 1.4 UoM Conversion in SCM

**Status:** `purchaseUnit`, `stockUnit`, `conversionFactor` exist in schema but are **not used** in SCM calculations.

**Implementation:**

In PR creation, when ordering, convert display units:

```tsx
// Show: "Beras — Stok: 500g, Beli: 1 Sak (25kg)"
// Order qty is in purchaseUnit, inventory qty is in stockUnit
const orderQtyInStockUnit = orderQty * ingredient.conversionFactor;
```

In `receiveDeliveryNote`, when recording received qty, convert from purchaseUnit to stockUnit before updating inventory.

---

## Module 2: POS (Point of Sale)

### 2.1 Modifier BOM (Add-ons Inventory Deduction) — CRITICAL

**Status:** Modifiers have prices but **no ingredient BOM**. "Extra Telur" doesn't deduct an egg.

**Schema change:** Add `modifierIngredients` table:

```ts
export const modifierIngredients = pgTable(
  "modifier_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modifierId: uuid("modifier_id")
      .notNull()
      .references(() => modifiers.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [unique("mod_ing_unique").on(t.modifierId, t.ingredientId)],
);
```

**Seed data:** Map modifiers to ingredients:

```ts
export const MODIFIER_INGREDIENTS = [
  { modifierCode: "EXT-KEJU", ingredientCode: "KEJU", quantity: 50 }, // 50g extra cheese
  { modifierCode: "EXT-TELUR", ingredientCode: "TELUR", quantity: 1 }, // 1 egg
];
```

**Server:** In `createOrder`, after deducting base recipe ingredients, also deduct modifier ingredients:

```ts
for (const mod of item.selectedModifiers ?? []) {
  const modIngs = await db
    .select()
    .from(modifierIngredients)
    .where(eq(modifierIngredients.modifierId, mod.modifierId));
  for (const mi of modIngs) {
    const deductQty = mi.quantity * item.quantity;
    // Deduct from inventory (same pattern as base ingredients)
    // Create stock ledger entry with type "OUT"
  }
}
```

**Modifier group management UI:** In `src/routes/_layout/modifier-groups/$mgId.tsx`, add a section to assign ingredients to each modifier:

```tsx
<h3>Bahan Baku Modifier</h3>;
{
  group.modifiers.map((mod) => (
    <div key={mod.id}>
      <span>{mod.name}</span>
      <select onChange={(e) => setModIngredient(mod.id, e.target.value)}>
        <option value="">Tidak memotong stok</option>
        {ingredients.map((ing) => (
          <option key={ing.id} value={ing.id}>
            {ing.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        placeholder="Qty"
        onChange={(e) => setModIngredientQty(mod.id, Number(e.target.value))}
      />
    </div>
  ));
}
```

---

### 2.2 Exclusion Logic Completion — CRITICAL

**Status:** `orderItemExclusions` is populated but **inventory is never restored**.

**Implementation:**

In `createOrder`, after deducting base ingredients, restore excluded ingredients:

```ts
// After deducting base ingredients:
const exclusions = await db
  .select()
  .from(orderItemExclusions)
  .where(eq(orderItemExclusions.orderItemId, orderItem.id));

for (const ex of exclusions) {
  const [inv] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.branchId, data.branchId), eq(inventory.ingredientId, ex.ingredientId)))
    .limit(1);

  if (inv) {
    const newQty = inv.quantity + ex.quantity;
    await db.update(inventory).set({ quantity: newQty }).where(eq(inventory.id, inv.id));
    await db.insert(stockLedger).values({
      branchId: data.branchId,
      ingredientId: ex.ingredientId,
      type: "IN",
      quantity: ex.quantity,
      balance: newQty,
      reference: order.id,
      notes: `Exclude restore: ${ex.ingredientId}`,
    });
  }
}
```

Also adjust COGS: subtract the cost of excluded ingredients from `totalCogs`.

---

### 2.3 Historical COGS Snapshot — CRITICAL

**Status:** `cogsAtTransaction` column exists in `orderItems` but is **always 0**.

**Implementation:**

In `createOrder`, when creating each order item:

```ts
// Calculate per-unit COGS for this specific transaction
let itemCogs = 0;

// Base recipe ingredients
const ings = await db
  .select()
  .from(recipeIngredients)
  .where(eq(recipeIngredients.recipeId, item.recipeId));
for (const ing of ings) {
  const [ingData] = await db
    .select({ averageCost: ingredients.averageCost })
    .from(ingredients)
    .where(eq(ingredients.id, ing.ingredientId))
    .limit(1);
  itemCogs += (ingData?.averageCost ?? 0) * ing.quantity;
}

// Modifier ingredients
for (const mod of item.selectedModifiers ?? []) {
  const modIngs = await db
    .select()
    .from(modifierIngredients)
    .where(eq(modifierIngredients.modifierId, mod.modifierId));
  for (const mi of modIngs) {
    const [ingData] = await db
      .select({ averageCost: ingredients.averageCost })
      .from(ingredients)
      .where(eq(ingredients.id, mi.ingredientId))
      .limit(1);
    itemCogs += (ingData?.averageCost ?? 0) * mi.quantity;
  }
}

// Exclusion adjustments
const exclusions = await db
  .select()
  .from(recipeModifierExclusions)
  .where(
    and(
      eq(recipeModifierExclusions.recipeId, item.recipeId),
      inArray(
        recipeModifierExclusions.modifierId,
        (item.selectedModifiers ?? []).filter((m) => m.isExclusion).map((m) => m.modifierId),
      ),
    ),
  );
for (const ex of exclusions) {
  const [ingData] = await db
    .select({ averageCost: ingredients.averageCost })
    .from(ingredients)
    .where(eq(ingredients.id, ex.ingredientId))
    .limit(1);
  itemCogs -= (ingData?.averageCost ?? 0) * ex.quantity;
}

// Store snapshot
const [orderItem] = await db
  .insert(orderItems)
  .values({
    orderId: order.id,
    recipeId: item.recipeId,
    brandId: item.brandId,
    quantity: item.quantity,
    price: item.price,
    cogsAtTransaction: Math.max(0, itemCogs), // per-unit COGS snapshot
    notes: item.notes,
  })
  .returning();
```

**Also update `totalCogs` on the order** to use these snapshots instead of live ingredient costs:

```ts
const totalCogs = orderItems.reduce((sum, oi) => sum + oi.cogsAtTransaction * oi.quantity, 0);
await db.update(orders).set({ totalCogs }).where(eq(orders.id, order.id));
```

---

### 2.4 Print Bill (Preliminary Bill) — HIGH PRIORITY

**FRD §2.12:** "Tombol 'Print Bill' yang bisa ditekan sebelum transaksi diselesaikan."

**Implementation:**

Add a "🖨️ Print Bill" button in the cart sidebar:

```tsx
<button
  onClick={() => printBill(cart, branchName)}
  className="w-full h-9 rounded-md border text-sm font-medium flex items-center justify-center gap-2"
>
  <Printer className="h-4 w-4" />
  Print Bill
</button>
```

The `printBill` function opens a popup with "BELUM DIBAYAR" watermark and current cart contents. See `plans/pos-advance.md` for full HTML template.

---

### 2.5 Re-Print Approval Flow — HIGH PRIORITY

**Status:** Server functions exist (`src/lib/server/approvals.ts`) but UI pages are **hardcoded mocks**.

**Implementation:**

1. **POS UI:** When cashier clicks "🖨️" on a past order, create a print request:

   ```tsx
   const requestMutation = useMutation({
     mutationFn: requestReprint, // from approvals.ts
   });
   // Show: "Menunggu persetujuan Area Manager"
   ```

2. **Area Manager page:** Replace `src/routes/_layout/print-requests.tsx` mock with real data:

   ```tsx
   const { data: pending } = useQuery({
     queryKey: ["print-requests"],
     queryFn: () => getPendingApprovals({ data: {} }),
   });
   ```

3. **Polling:** POS polls for approval status every 5 seconds:
   ```tsx
   useQuery({
     queryKey: ["print-status", requestId],
     queryFn: () => getPrintRequestStatus({ data: { id: requestId } }),
     refetchInterval: 5000,
     enabled: !!requestId,
     onSuccess: (data) => {
       if (data.status === "Approved") {
         printReceipt(order, cartItems, branchName);
       }
     },
   });
   ```

---

### 2.6 Cancel Request Approval Flow — HIGH PRIORITY

**Status:** Same as print requests — server functions exist but UI is a **mock**.

**Implementation:**

Replace `src/routes/_layout/cancel-requests.tsx` with real data:

```tsx
const { data: cancelRequests } = useQuery({
  queryKey: ["cancel-requests"],
  queryFn: () => getPendingCancelRequests({ data: {} }),
});
```

Add approve/reject mutations with system notifications to the requesting cashier.

---

### 2.7 Negative Stock Soft Block — HIGH PRIORITY

**FRD §2.1:** "POS diizinkan untuk terus menjual meskipun stok menunjukkan angka 0 (stok akan menjadi minus)."

**Current:** `createOrder` throws `Error("Stok tidak mencukupi...")` and blocks the sale.

**Implementation:**

In `createOrder`, replace the hard block with a soft block + notification:

```ts
// BEFORE:
if (!inv || inv.quantity < deductQty) {
  throw new Error(`Stok tidak mencukupi untuk...`);
}

// AFTER:
if (!inv || inv.quantity < deductQty) {
  const shortfall = deductQty - (inv?.quantity ?? 0);
  // Still proceed with sale
  // Create negative stock alert notification
  const ams = await db
    .select({ userId: areaManagerBranches.userId })
    .from(areaManagerBranches)
    .where(eq(areaManagerBranches.branchId, data.branchId));
  for (const am of ams) {
    await db.insert(systemNotifications).values({
      userId: am.userId,
      title: "⚠️ Stok Minus",
      message: `${ingData?.name}: minus ${shortfall} pcs setelah order #${order.id.slice(0, 8)}`,
      type: "alert",
    });
  }
}

// Allow negative inventory:
const newQty = (inv?.quantity ?? 0) - deductQty;
```

---

### 2.8 Flexible PB1 Tax Rate per Branch — HIGH PRIORITY

**FRD §2.3:** "PB1 dapat diatur menjadi '0' (Nihil) per cabang."

**Implementation:**

1. Add `pb1Rate` to branches:

   ```ts
   pb1Rate: integer("pb1_rate").notNull().default(11),
   ```

2. In POS loader, fetch branch PB1 rate:

   ```tsx
   const branch = await getBranch({ data: { id: activeBranchId } });
   const pb1Rate = branch?.pb1Rate ?? 11;
   ```

3. In cart calculations:

   ```tsx
   const taxAmount = useMemo(() => {
     if (!pb1Enabled || pb1Rate === 0) return 0;
     return Math.round(subtotalAfterDiscount * (pb1Rate / 100));
   }, [pb1Enabled, pb1Rate, subtotalAfterDiscount]);
   ```

4. UI: Show "PB1 {pb1Rate}%" instead of "PPN 11%". Hide toggle entirely if `pb1Rate === 0`.

---

### 2.9 Bundle Parent-Child Logic — HIGH PRIORITY

**FRD §2.9:** "Menu Paket memotong stok dari Menu Satuan (Child SKU)."

**Status:** `recipeChildRecipes` table exists but `createOrder` **never uses it**.

**Implementation:**

In `createOrder`, after getting parent recipe ingredients, also get child recipes and their ingredients:

```ts
const childLinks = await db
  .select()
  .from(recipeChildRecipes)
  .where(eq(recipeChildRecipes.parentRecipeId, item.recipeId));

for (const link of childLinks) {
  const childIngs = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, link.childRecipeId));
  for (const ing of childIngs) {
    const deductQty = ing.quantity * link.quantity * item.quantity;
    // Deduct from inventory (same pattern)
  }
}
```

Also update `getPosMenu` to include `isBundle` flag and `childRecipes` data.

---

### 2.10 Session Restriction (1 Device per Cashier) — MEDIUM PRIORITY

**FRD §2:** "1 akun Branch Admin hanya memiliki 1 sesi login aktif."

**Implementation:**

1. Add `userSessions` table:

   ```ts
   export const userSessions = pgTable("user_sessions", {
     id: uuid("id").defaultRandom().primaryKey(),
     userId: uuid("user_id")
       .notNull()
       .references(() => users.id),
     sessionToken: text("session_token").notNull().unique(),
     deviceInfo: text("device_info"),
     ipAddress: text("ip_address"),
     createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
     lastActiveAt: timestamp("last_active_at", { mode: "date" }).defaultNow().notNull(),
   });
   ```

2. On login (email + PIN), invalidate all other sessions:

   ```ts
   // After successful auth:
   await db.delete(userSessions).where(eq(userSessions.userId, user.id));
   await db.insert(userSessions).values({ userId: user.id, sessionToken, deviceInfo });
   ```

3. On every API call, check session validity:
   ```ts
   // Middleware or in requireAuth:
   const session = await db
     .select()
     .from(userSessions)
     .where(eq(userSessions.sessionToken, token))
     .limit(1);
   if (!session) throw new Error("Session invalidated by new login");
   ```

---

## Module 3: Deep Inventory

### 3.1 Server-Side Pagination — CRITICAL

**FRD §3.3 & §6.6:** "Setiap halaman inventaris wajib menggunakan Pagination (10-15 item). DILARANG fetch all."

**Current:** All inventory/ledger/waste/SCM pages fetch ALL records.

**Implementation:**

Update ALL server functions to accept pagination params. Pattern for each:

```ts
export const getInventory = createServerFn({ method: "GET" })
  .inputValidator((data: {
    branchId: string;
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) => data)
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 15, 50);
    const offset = (data.page ?? 0) * limit;

    const conditions = [eq(inventory.branchId, data.branchId)];
    if (data.search) {
      conditions.push(
        or(
          like(ingredients.name, `%${data.search}%`),
          like(ingredients.code, `%${data.search}%`),
        ),
      );
    }
    if (data.category) conditions.push(eq(ingredients.category, data.category));

    const result = await db
      .select({...})
      .from(inventory)
      .leftJoin(ingredients, eq(inventory.ingredientId, ingredients.id))
      .where(and(...conditions))
      .orderBy(data.sortOrder === "desc" ? desc(ingredients.name) : asc(ingredients.name))
      .limit(limit)
      .offset(offset);

    return result;
  });
```

**Files to update:**
| Function | File | Current Limit |
|----------|------|---------------|
| `getInventory` | `inventory.ts` | No limit |
| `getStockLedger` | `inventory.ts` | No limit |
| `getStockOpnames` | `inventory.ts` | No limit |
| `getWasteEntries` | `waste.ts` | No limit |
| `getOrders` | `pos.ts` | 100 |
| `getPurchaseRequisitions` | `scm.ts` | No limit |
| `getPurchaseOrders` | `scm.ts` | No limit |
| `getDeliveryNotes` | `scm.ts` | No limit |
| `getSCMInvoices` | `scm.ts` | No limit |
| `getStockTransfers` | `scm.ts` | No limit |
| `getSupplierDeliveries` | `supplier-deliveries.ts` | No limit |
| `getUsers` | `users.ts` | No limit |
| `getSystemLogs` | `system.ts` | 50 |
| `getAuditLogs` | `system.ts` | 50 |
| `getDashboardData` | `dashboard.ts` | 100 |

**UI pages to update:** All pages using these functions need pagination controls (previous/next page numbers, page size selector).

---

### 3.2 Inventory Search, Filter, Sort — HIGH PRIORITY

**FRD §3.3:** "Terdapat Search Bar dan fitur Sortir di setiap halaman rekap stok. Filter kategori: Dry, Fresh, Packaging, Bahan Baku."

**Implementation:**

Add to `src/routes/_layout/inventory/index.tsx`:

```tsx
<div className="flex items-center gap-3 mb-4">
  <div className="relative flex-1 max-w-xs">
    <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
    <input
      type="text"
      placeholder="Cari bahan..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="h-9 w-full rounded-md border pl-8 pr-3 text-sm"
    />
  </div>
  <select value={category} onChange={(e) => setCategory(e.target.value)}>
    <option value="">Semua Kategori</option>
    <option value="dry">Dry (Kering)</option>
    <option value="fresh">Fresh (Segar)</option>
    <option value="packaging">Packaging (Kemasan)</option>
    <option value="bahan_baku">Bahan Baku</option>
  </select>
  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
    <option value="name">Nama</option>
    <option value="quantity">Jumlah Stok</option>
    <option value="lastUpdated">Terakhir Update</option>
  </select>
</div>
```

Same pattern for Stock Ledger page with date range filter.

---

### 3.3 Smart Reordering (ROP/ROQ Auto-Calculation) — HIGH PRIORITY

**FRD §5.3:** "Formula: (Rata-rata keluar stok per hari) × 5 hari. Dibulatkan ke atas sesuai MOQ."

**Status:** `rop`, `roq`, `moq` fields exist but are **never auto-calculated**.

**Implementation:**

Create `calculateSmartReorder` function:

```ts
export async function calculateSmartReorder(ingredientId: string, branchId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const outEntries = await db
    .select({ quantity: stockLedger.quantity })
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.ingredientId, ingredientId),
        eq(stockLedger.branchId, branchId),
        eq(stockLedger.type, "OUT"),
        gte(stockLedger.createdAt, thirtyDaysAgo),
      ),
    );

  const totalOut = outEntries.reduce((sum, e) => sum + e.quantity, 0);
  const avgDaily = totalOut / 30;
  const recommendedQty = Math.ceil(avgDaily * 5);

  const [ing] = await db
    .select()
    .from(ingredients)
    .where(eq(ingredients.id, ingredientId))
    .limit(1);
  const moq = ing?.moq ?? 1;
  const roundedQty = Math.ceil(recommendedQty / moq) * moq;

  await db
    .update(ingredients)
    .set({ rop: Math.ceil(avgDaily * 3), roq: roundedQty })
    .where(eq(ingredients.id, ingredientId));
}
```

Add a "Generate Rekomendasi" button on the Purchase Requisition page. When clicked, calculate smart reorder for all ingredients and pre-fill the PR form.

Also add ROP/ROQ display to the inventory page with visual indicators:

```tsx
{
  inv.quantity <= ingredient.rop && (
    <Badge variant="warning">Stok di bawah ROP ({ingredient.rop})</Badge>
  );
}
```

---

### 3.4 Yield Costing Formula — MEDIUM PRIORITY

**FRD §5.1:** "HPP produk matang = Total modal RM / Kuantitas matang."

**Current:** `createYieldConversion` doesn't update ingredient cost.

**Implementation:**

In `src/lib/server/yield.ts` `createYieldConversion`:

```ts
const rawMaterialCost = rawInputQty * rawMaterial.averageCost;
const newCostPerUnit = Math.round(rawMaterialCost / finishedOutputQty);

await db
  .update(ingredients)
  .set({ averageCost: newCostPerUnit })
  .where(eq(ingredients.id, finishedGoodId));

// Trigger BOM cost roll-up for all recipes using this ingredient
await recalculateRecipeCostsForIngredient(finishedGoodId);
```

---

### 3.5 Countable vs Uncountable Items — MEDIUM PRIORITY

**FRD §8.1:** "Some items are countable (nasi ayam, bowl) vs uncountable (broken stock). Uncountable items do not enter SO."

**Status:** `countable` boolean exists on `ingredients` but is **not used** in SO.

**Implementation:**

In `triggerStockOpname`, filter out uncountable items:

```ts
const countableIngredients = await db
  .select()
  .from(ingredients)
  .where(eq(ingredients.countable, true));

// Only create SO items for countable ingredients
for (const ing of countableIngredients) {
  await db.insert(stockOpnameItems).values({
    stockOpnameId: so.id,
    ingredientId: ing.id,
    systemStock: /* current inventory qty */,
    physicalStock: 0,
  });
}
```

Display `countable` badge on ingredient list and form.

---

## Module 4: Supply Chain (SCM)

### 4.1 PR with Stock Indicator — HIGH PRIORITY

**FRD §4.2.1:** "Form PR wajib memunculkan kolom 'Sisa Stok Aktual' di samping kolom jumlah order."

**Implementation:**

In `src/routes/_layout/purchase-requisitions/index.tsx`:

```tsx
{
  prItems.map((item) => (
    <div key={item.ingredientId} className="flex items-center gap-3">
      <span className="flex-1">{item.ingredientName}</span>
      <span className="text-xs text-muted-foreground w-24">
        Stok: {branchInventory.find((i) => i.ingredientId === item.ingredientId)?.quantity ?? 0}
      </span>
      <input
        type="number"
        value={item.quantity}
        onChange={(e) => updateQty(item.ingredientId, Number(e.target.value))}
        className="h-8 w-20 text-right"
      />
      <span className="text-xs text-emerald-600 w-24">Rekomendasi: {item.roq}</span>
    </div>
  ));
}
```

---

### 4.2 In-Transit Tracking — MEDIUM PRIORITY

**FRD §4.2.2:** "Saat Admin Pusat mengonfirmasi pengiriman, stok masuk ke status In-Transit (Gudang Virtual)."

**Status:** `inTransitInventory` table exists and is populated in `shipDeliveryNote`.

**Gap:** No UI page to view in-transit inventory.

**Implementation:**

Add an "In Transit" view to the inventory page or a dedicated page:

```tsx
const { data: inTransit } = useQuery({
  queryKey: ["in-transit", activeBranchId],
  queryFn: () => getInTransitInventory({ data: { branchId: activeBranchId } }),
});
```

Display items currently in transit with expected arrival (SJ code, from branch, items, quantities).

---

## Module 5: Waste & Broken Stock

### 5.1 Waste Auto-Link to Broken Stock — MEDIUM PRIORITY

**FRD §5.1.2:** "Setiap input Waste kategori 'Biaya Operasional' wajib terhubung (auto-link) ke daftar Broken Stock."

**Current:** `createWasteEntry` inserts into `wasteEntries` but doesn't create a corresponding `brokenStock` record.

**Implementation:**

In `createWasteEntry`, when category is "Biaya Operasional":

```ts
if (data.category === "Biaya Operasional") {
  await db.insert(brokenStock).values({
    wasteEntryId: wasteEntry.id,
    ingredientId: data.ingredientId,
    quantity: data.quantity,
    reason: data.notes ?? "Biaya Operasional",
    branchId: data.branchId,
    reportedBy: user.id,
  });
}
```

Display linked broken stock entries on the waste detail page.

---

### 5.2 Automated Waste Valuation — MEDIUM PRIORITY

**FRD §4.4.2:** "Setiap input Waste otomatis dikalikan dengan HPP Master Terbaru."

**Current:** Waste entries store quantity but no cost value.

**Implementation:**

Add `costValue` to waste entries (or calculate on-the-fly):

```ts
const [ing] = await db
  .select({ averageCost: ingredients.averageCost })
  .from(ingredients)
  .where(eq(ingredients.id, data.ingredientId))
  .limit(1);

const costValue = (ing?.averageCost ?? 0) * data.quantity;
// Store in wasteEntries.costValue or calculate in reports
```

Display cost value in waste table and analytics.

---

## Module 6: Audit & Stock Opname

### 6.1 SO Trigger Logging — MEDIUM PRIORITY

**FRD §6.1.3:** "Sistem wajib mencatat riwayat log: Siapa (User ID) yang men-trigger SO beserta timestamp."

**Current:** `triggerStockOpname` creates the SO but doesn't log who triggered it.

**Implementation:**

Add `triggeredBy` and `triggeredAt` to `stockOpnames` table:

```ts
triggeredBy: uuid("triggered_by").references(() => users.id),
triggeredAt: timestamp("triggered_at", { mode: "date" }),
```

In `triggerStockOpname`:

```ts
const [so] = await db
  .insert(stockOpnames)
  .values({
    branchId: data.branchId,
    date: data.date,
    status: "Submitted",
    triggeredBy: user.id,
    triggeredAt: new Date(),
  })
  .returning();
```

Display triggered by name on SO detail page.

---

## Module 7: Finance & Reconciliation

### 7.1 MDR Calculation per Platform — HIGH PRIORITY

**FRD §4.6:** "Omzet Netto = Total Gross Sales - Merchant Diskon - Estimasi Potongan MDR Ojol."

**Current:** `createOrder` calculates `mdrFee` from `platformFees` table. This is correct.

**Gap:** The finance dashboard doesn't show net revenue after MDR.

**Implementation:**

In `getFinanceSummary`, include:

```ts
const netRevenue = totalRevenue - totalMerchantDiscount - totalMdrFee;
```

Display on finance page:

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
  <StatCard label="Omzet Bruto" value={summary.grossRevenue} />
  <StatCard label="Diskon Merchant" value={summary.merchantDiscount} color="red" />
  <StatCard label="MDR Ojol" value={summary.mdrFee} color="red" />
  <StatCard label="Omzet Netto" value={summary.netRevenue} color="green" />
</div>
```

---

### 7.2 Historical COGS Lock — CRITICAL

**FRD §4.6:** "Laporan Finansial masa lalu harus dihitung berdasarkan Snapshot HPP. Perubahan HPP Master TIDAK BOLEH mengubah angka transaksi masa lalu."

**Current:** Finance reports use live `averageCost` from ingredients table.

**Implementation:**

Change all finance queries to use `orderItems.cogsAtTransaction` (once populated per §2.3):

```ts
// BEFORE (wrong — uses live cost):
const totalCogs = await db
  .select({ total: sql<number>`SUM(${orderItems.quantity} * ${ingredients.averageCost})` })
  .from(orderItems)
  .leftJoin(ingredients, eq(orderItems.recipeId, ingredients.id))
  ...

// AFTER (correct — uses snapshot):
const totalCogs = await db
  .select({ total: sql<number>`SUM(${orderItems.quantity} * ${orderItems.cogsAtTransaction})` })
  .from(orderItems)
  ...
```

---

## Module 8: Period Control

### 8.1 Negative Inventory Check Before Close — HIGH PRIORITY

**FRD §4.1.5:** "Period Control akan mengunci tombol 'Finalize & Lock' jika masih ada SKU di cabang yang berstatus minus."

**Implementation:**

In `closePeriod` server function:

```ts
const negativeStock = await db
  .select()
  .from(inventory)
  .where(and(eq(inventory.branchId, branchId), lt(inventory.quantity, 0)));

if (negativeStock.length > 0) {
  const itemNames = negativeStock.map((n) => n.ingredientId).join(", ");
  throw new Error(
    `Tidak dapat menutup periode. Stok minus terdeteksi pada: ${itemNames}. Lakukan SO atau terima SCM terlebih dahulu.`,
  );
}
```

Display a "Pre-Close Checklist" on the period control page:

```tsx
<ul className="space-y-2">
  <li className="flex items-center gap-2">
    {negativeStock.length === 0 ? (
      <Check className="text-green-500" />
    ) : (
      <X className="text-red-500" />
    )}
    Stok tidak ada yang minus
  </li>
  <li>...</li>
</ul>
```

---

### 8.2 Pre-Open Report — MEDIUM PRIORITY

**FRD §4.1.1:** "Sebelum membuka periode, sistem menyajikan Pre-Open Report: saldo akhir stok, harga bahan baku terbaru, status integrasi platform."

**Implementation:**

Add a modal before `openPeriod` that shows:

1. Closing balances from last period (per branch)
2. Latest ingredient costs (top 10 changes)
3. Platform fee status (active/inactive)
4. Pending PRs/POs/SJs

---

## Module 9: Analytics & Reporting

### 9.1 Hourly Heatmap — MEDIUM PRIORITY

**FRD §6.1:** "Analisis beban kerja dapur berdasarkan jam pesanan."

**Implementation:**

Query orders grouped by hour:

```ts
const hourlyData = await db
  .select({
    hour: sql<string>`EXTRACT(HOUR FROM ${orders.createdAt})`,
    count: sql<number>`COUNT(*)`,
    revenue: sql<number>`SUM(${orders.totalAmount})`,
  })
  .from(orders)
  .where(/* date range filter */)
  .groupBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`)
  .orderBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`);
```

Display as a bar chart in analytics:

```tsx
<BarChart data={hourlyData}>
  <XAxis dataKey="hour" />
  <YAxis />
  <Bar dataKey="count" fill="#8884d8" />
</BarChart>
```

---

### 9.2 Top Sales with Filter — MEDIUM PRIORITY

**FRD §6.4:** "Grafik Top Sales dengan filter Cabang dan Kategori Menu."

**Current:** Analytics page has top sales chart but **no category filter**.

**Implementation:**

Add category filter to analytics:

```tsx
<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
  <option value="">Semua Kategori</option>
  <option value="makanan">Makanan</option>
  <option value="minuman">Minuman</option>
  <option value="snack">Snack</option>
  <option value="paket">Paket Bundle</option>
  <option value="add_ons">Add-on</option>
</select>
```

Update `getSalesAnalytics` to accept `category` param and filter recipes by category.

---

### 9.3 PDF Export — MEDIUM PRIORITY

**FRD §6.5:** "Fitur cetak langsung (Print PDF) untuk Dashboard dan ekspor laporan Audit Stock."

**Implementation:**

Use `jspdf` or `html2pdf.js` for PDF generation:

```tsx
import html2pdf from "html2pdf.js";

const exportPDF = () => {
  const element = document.getElementById("report-content");
  html2pdf().from(element).save("laporan-stock-opname.pdf");
};
```

Add "Export PDF" button to:

- Dashboard
- Stock Opname detail
- Discrepancy report
- Sales analytics

---

## Module 10: System Infrastructure

### 10.1 Logging Wiring — HIGH PRIORITY

**Status:** `src/lib/server/logging.ts` exists with `logSystemAction` and `logAudit`, but they're **not imported in all server files**.

**Audit required:** Check every server file and add logging to all mutation functions:

| File                     | Functions needing logs                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| `branches.ts`            | `createBranch`, `updateBranch`                                             |
| `brands.ts`              | `createBrand`, `updateBrand`                                               |
| `ingredients.ts`         | `createIngredient`, `updateIngredient`                                     |
| `recipes.ts`             | `createRecipe`, `updateRecipe`                                             |
| `modifier-groups.ts`     | `createModifierGroup`, `updateModifierGroup`                               |
| `vouchers.ts`            | `createVoucher`, `updateVoucher`                                           |
| `platform-fees.ts`       | `updatePlatformFee`                                                        |
| `inventory.ts`           | `triggerStockOpname`, `submitStockOpname`, `approveStockOpname`            |
| `waste.ts`               | `createWasteEntry`                                                         |
| `yield.ts`               | `createYieldConversion`                                                    |
| `finance.ts`             | `createManualRevenue`, `createChannelRevenue`, `openPeriod`, `closePeriod` |
| `scm.ts`                 | All mutation functions (PR, PO, SJ, Invoice, Stock Transfer)               |
| `supplier-deliveries.ts` | All mutation functions                                                     |
| `users.ts`               | `createUser`, `updateUser`                                                 |

See `plans/system-logs.md` for detailed per-function logging specs.

---

### 10.2 Notification System Completion — MEDIUM PRIORITY

**Status:** `NotificationBell` component works. `systemNotifications` table exists. But **not all events create notifications**.

**Events that should create notifications:**

| Event                      | Recipient          | Type    |
| -------------------------- | ------------------ | ------- |
| Negative stock detected    | Area Manager       | alert   |
| Print request created      | Area Manager       | info    |
| Print request approved     | Requesting cashier | info    |
| Cancel request created     | Area Manager       | warning |
| Cancel request approved    | Requesting cashier | info    |
| Stock opname variance > 3% | Area Manager       | alert   |
| Stock opname approved      | Branch Admin       | info    |
| Purchase order processed   | Branch Admin       | info    |
| Delivery note shipped      | Branch Admin       | info    |
| Delivery note received     | Admin Pusat        | info    |
| Invoice generated          | Branch Admin       | info    |
| Stock transfer approved    | Branch Admin       | info    |
| Period opened              | All users          | info    |
| Period closed              | All users          | warning |
| Yield conversion completed | Central Kitchen    | info    |

---

## Implementation Phases

### Phase 1: Critical Business Logic (Week 1)

Priority: Features that affect daily operations and financial accuracy.

1. **BOM Cost Roll-Up wiring** — Call `recalculateRecipeCostsForIngredient` after every cost change
2. **Historical COGS Snapshot** — Populate `cogsAtTransaction` in `createOrder`
3. **Modifier BOM** — Add `modifierIngredients` table + deduct in `createOrder`
4. **Exclusion Restore** — Restore excluded ingredient quantities to inventory
5. **Bundle Logic** — Deduct child recipe ingredients in `createOrder`
6. **Negative Stock Soft Block** — Allow negative + notify Area Manager
7. **Flexible PB1** — Add `pb1Rate` to branches + use in POS

### Phase 2: Data Integrity & UX (Week 2)

Priority: Pagination, search, filtering, and approval flows.

8. **Server-Side Pagination** — All list endpoints + UI controls
9. **Search & Filter** — Inventory, ledger, orders, SCM pages
10. **Print/Cancel Request UI** — Replace mocks with real data + mutations
11. **Smart Reordering** — Auto-calculate ROP/ROQ + PR pre-fill
12. **Session Restriction** — 1 device per cashier
13. **Logging Wiring** — Add system/audit logs to all mutations

### Phase 3: Analytics & Advanced Features (Week 3)

Priority: Reporting, analytics, and optimization features.

14. **Yield Costing** — Update ingredient cost after yield conversion
15. **Finance MDR Display** — Net revenue after MDR on dashboard
16. **SO Trigger Logging** — Track who triggered each SO
17. **Negative Inventory Period Check** — Block period close if negative
18. **Hourly Heatmap** — Kitchen workload chart
19. **PDF Export** — Dashboard + SO reports
20. **Notification Events** — Wire all events to notification system

---

## Files to Create

| File                                     | Purpose                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| `src/lib/server/notifications.ts`        | Centralized notification creation helpers               |
| `src/lib/server/session.ts`              | Device/session restriction logic                        |
| `src/routes/_layout/approvals/index.tsx` | Unified approval dashboard (print + cancel + transfers) |

## Files to Modify (Summary)

**Schema:** `src/db/schema.ts` — `pb1Rate`, `modifierIngredients`, `userSessions`, SO trigger fields
**Server:** 15+ files — Add pagination params, wire cost roll-up, add modifier BOM, fix exclusion restore, add notifications
**UI:** 20+ pages — Add pagination controls, search/filter inputs, real data for approval pages, PB1 display, bundle badges
**Seed:** `src/lib/seed/seed-data.ts`, `src/lib/seed/seed.ts` — Modifier ingredient mappings

---

## Verification Checklist

- [ ] `vp check --fix` passes
- [ ] `vp build` succeeds
- [ ] Updating ingredient cost auto-updates all recipe `totalCogs`
- [ ] Order creates `cogsAtTransaction` snapshot > 0
- [ ] Modifier with BOM deducts modifier ingredients from inventory
- [ ] Exclusion modifier restores excluded ingredient quantity
- [ ] Bundle order deducts child recipe ingredients
- [ ] Order with insufficient stock still succeeds (soft block)
- [ ] Negative stock creates notification for Area Manager
- [ ] Branch with `pb1Rate = 0` hides PB1 toggle in POS
- [ ] Branch with `pb1Rate = 5` calculates tax correctly
- [ ] Inventory page shows 15 items with pagination
- [ ] Search/filter on inventory works
- [ ] Print request creates approval → Area Manager approves → receipt prints
- [ ] Cancel request creates approval → Area Manager approves → order voided
- [ ] Smart reorder calculates ROP/ROQ from 30-day usage
- [ ] Yield conversion updates finished good cost + triggers roll-up
- [ ] Period close blocked if any SKU is negative
- [ ] Finance dashboard shows Gross, MDR, Net revenue
- [ ] Historical reports use `cogsAtTransaction` not live cost
- [ ] All mutation functions log to system_logs and audit_logs
