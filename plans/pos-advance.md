# POS Advanced Features — Comprehensive Implementation Plan

## Analysis: FRD vs. Current Codebase vs. Old Prototype

This plan cross-references the **Functional Requirement Document (FRD)** against the **current codebase** and the **old prototype** (`../omoiyari_pos`) to identify every gap that must be filled.

---

## Status Matrix

| #   | FRD Requirement                            | Schema | Server | UI  | Status      |
| --- | ------------------------------------------ | ------ | ------ | --- | ----------- |
| 1   | Request Cancel/Edit centralized            | ✅     | ✅     | ✅  | **Done**    |
| 2   | Negative Stock Tolerance (Soft Block)      | ✅     | ❌     | N/A | **MISSING** |
| 3   | Negative Alert → Area Manager              | ✅     | ❌     | ❌  | **MISSING** |
| 4   | Flexible PB1 Tax (dynamic, can be 0)       | ✅     | ❌     | ❌  | **MISSING** |
| 5   | Search Bar Menu                            | ✅     | ✅     | ✅  | **Done**    |
| 6   | Filtering (Brand/Category tabs)            | ✅     | ✅     | ✅  | **Done**    |
| 7   | Cross-Brand Cart                           | ✅     | ✅     | ✅  | **Done**    |
| 8   | Modifiers & Add-ons UI                     | ✅     | ✅     | ✅  | **Done**    |
| 9   | Pin Login Kasir                            | ✅     | ✅     | ✅  | **Done**    |
| 10  | **Bundling Parent-Child Logic**            | ✅     | ❌     | ❌  | **MISSING** |
| 11  | Standby UI — 3 Last Orders                 | ✅     | ✅     | ✅  | **Done**    |
| 12  | Dropdown Detail & Re-Print Approval        | ✅     | ❌     | ❌  | **MISSING** |
| 13  | **Print Bill Button**                      | ❌     | ❌     | ❌  | **MISSING** |
| 14  | Deep Inventory                             | ✅     | ✅     | ✅  | **Done**    |
| 15  | **Add-ons & Modifier BOM**                 | ❌     | ❌     | ❌  | **MISSING** |
| 16  | **Exclusion Logic (Minus Modifier)**       | ✅     | ⚠️     | ✅  | **Partial** |
| 17  | Pagination & Filter on Inventory           | ❌     | ❌     | ❌  | **MISSING** |
| 18  | Logical Branch Masking                     | ✅     | ✅     | ✅  | **Done**    |
| 19  | BOM Cost Roll-Up                           | ❌     | ❌     | ❌  | **MISSING** |
| 20  | **Device/Session Restriction**             | ❌     | ❌     | ❌  | **MISSING** |
| 21  | Single Base Pricing (Bottom Price)         | ✅     | ❌     | ❌  | **MISSING** |
| 22  | Historical COGS Snapshot                   | ✅     | ❌     | ❌  | **MISSING** |
| 23  | Smart Reordering                           | ✅     | ❌     | ❌  | **MISSING** |
| 24  | Yield Costing Formula                      | ✅     | ❌     | ❌  | **MISSING** |
| 25  | Blind Stock Opname                         | ✅     | ❌     | ❌  | **MISSING** |
| 26  | Waste 3-Category Enforcement               | ✅     | ✅     | ⚠️  | **Partial** |
| 27  | **Print Request Approval Flow**            | ✅     | ❌     | ❌  | **MISSING** |
| 28  | **PB1 Merchant vs Platform discount base** | ❌     | ❌     | ❌  | **MISSING** |

**Legend:** ✅ = Done, ⚠️ = Partial, ❌ = Missing

---

## Module 1: POS Core (Critical — User-Facing Daily Operations)

### 1.1 Negative Stock Tolerance (Soft Block) — HIGH PRIORITY

**FRD §2.1:** "Modul POS diizinkan untuk terus menjual item meskipun stok di sistem menunjukkan angka 0. Stok akan menjadi minus."

**Current:** `createOrder` throws `Error("Stok tidak mencukupi...")` and blocks the transaction entirely.

**Change:**

In `src/lib/server/pos.ts` `createOrder`, replace the stock validation block:

```ts
// BEFORE (hard block):
if (!inv || inv.quantity < deductQty) {
  throw new Error(`Stok tidak mencukupi untuk...`);
}

// AFTER (soft block — allow negative, log alert):
if (!inv || inv.quantity < deductQty) {
  // Still allow the sale — inventory will go negative
  // But create a system notification for Area Manager
  const shortfall = deductQty - (inv?.quantity ?? 0);
  await db.insert(systemNotifications).values({
    userId: /* area manager of this branch */,
    title: "Stok Minus Terdeteksi",
    message: `Bahan "${ingData?.name}" di cabang ${branchName} minus ${shortfall} unit setelah order ${order.id.slice(0, 8)}`,
    type: "alert",
  });
}
```

The inventory update should use `Math.max(-999999, inv.quantity - deductQty)` instead of `Math.max(0, ...)` to allow negative values.

**Files:** `src/lib/server/pos.ts`

---

### 1.2 Negative Alert Notification — HIGH PRIORITY

**FRD §2.2:** "Setiap kali stok menembus angka minus, sistem mengirimkan notifikasi Flagging ke Area Manager."

**Current:** No notification system wired to negative stock events.

**Implementation:**

When `createOrder` detects that deducting inventory would result in a negative balance, after creating the order, send a notification to the Area Manager(s) assigned to that branch.

```ts
// After inventory deduction in createOrder:
const newQty = (inv?.quantity ?? 0) - deductQty;
if (newQty < 0) {
  // Find area managers for this branch
  const ams = await db
    .select({ userId: areaManagerBranches.userId })
    .from(areaManagerBranches)
    .where(eq(areaManagerBranches.branchId, data.branchId));

  for (const am of ams) {
    await db.insert(systemNotifications).values({
      userId: am.userId,
      title: "⚠️ Stok Minus",
      message: `${ingData?.name}: ${newQty} pcs di ${branchName}. Order #${order.id.slice(0, 8)}`,
      type: "alert",
    });
  }
}
```

**Files:** `src/lib/server/pos.ts`

---

### 1.3 Flexible PB1 Tax (Pajak Resto) — HIGH PRIORITY

**FRD §2.3:** "Komponen Pajak Restoran (PB1) dibuat dinamis dan dapat diatur menjadi '0' (Nihil)."

**Current:** PPN is hardcoded at 11% with a checkbox toggle. No configuration.

**Implementation:**

1. **Add `pb1Rate` to branches table** (or create a `branchSettings` table):

   ```ts
   pb1Rate: integer("pb1_rate").notNull().default(11), // 0-100, stored as percentage
   ```

2. **Add `pb1Enabled` to orders** (already have `taxAmount`, but need to know if PB1 was applied):
   Already exists as `ppnEnabled` state in POS UI.

3. **POS UI:** Instead of hardcoded "PPN 11%", show "PB1 {rate}%" from branch config. If `pb1Rate = 0`, hide the toggle entirely.

4. **Tax calculation base:** Per FRD §4.6, the tax base depends on discount type:
   - **Merchant-funded discount:** PB1 calculated AFTER discount
   - **Platform-funded discount:** PB1 calculated BEFORE discount

   Since current vouchers are merchant-funded, the existing calculation (`subtotalAfterDiscount * 0.11`) is correct for that case. For platform-funded discounts, a new field `platformDiscount` would be needed.

**Files:** `src/db/schema.ts`, `src/lib/server/pos.ts`, `src/routes/_layout/pos.tsx`

---

### 1.4 Print Bill Button (Cetak Tagihan Sementara) — HIGH PRIORITY

**FRD §2.12:** "Sistem POS menyediakan tombol 'Print Bill' yang bisa ditekan kasir sebelum transaksi diselesaikan."

**Current:** No print bill feature. Only receipt print after successful order.

**Implementation:**

Add a "🖨️ Print Bill" button in the cart sidebar (above the checkout button). This prints a **preliminary bill** (not a receipt) showing the current cart contents, subtotal, discounts, tax, and total — with "BELUM DIBAYAR" watermark.

```tsx
function printBill(cart: CartItem[], branchName: string, tableNumber?: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const html = `
    <html><head><style>
      @page { size: 80mm auto; margin: 0; }
      body { font-family: monospace; width: 80mm; padding: 5mm; font-size: 12px; }
      .watermark { text-align: center; border: 2px dashed #999; padding: 2mm; margin: 3mm 0; color: #999; font-weight: bold; }
      .total { font-size: 14px; font-weight: bold; }
    </style></head><body>
      <div class="watermark">BELUM DIBAYAR / UNPAID</div>
      <div style="text-align:center; font-weight:bold;">${branchName}</div>
      <div style="text-align:center; font-size:10px; color:#666;">
        ${new Date().toLocaleString("id-ID")}
      </div>
      <hr style="border-top: 1px dashed #000; margin: 3mm 0;">
      ${cart
        .map(
          (item) => `
        <div style="margin-bottom: 2mm;">
          <div style="display:flex; justify-content:space-between; font-weight:bold;">
            <span>${item.name}</span>
            <span>${item.quantity}x</span>
          </div>
          ${item.modifiers.map((m) => `<div style="font-size:10px; padding-left:2mm;">+ ${m.name}</div>`).join("")}
          ${item.notes ? `<div style="font-size:10px; padding-left:2mm; font-style:italic;">"${item.notes}"</div>` : ""}
          <div style="text-align:right; font-size:11px;">
            Rp ${(item.price * item.quantity).toLocaleString("id-ID")}
          </div>
        </div>
      `,
        )
        .join("")}
      <hr style="border-top: 1px dashed #000; margin: 3mm 0;">
      <div class="total" style="display:flex; justify-content:space-between;">
        <span>TOTAL</span>
        <span>Rp ${finalTotal.toLocaleString("id-ID")}</span>
      </div>
      <div class="watermark">BELUM DIBAYAR</div>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); }</script>
    </body></html>
  `;
  printWindow.document.write(html);
  printWindow.document.close();
}
```

**Files:** `src/routes/_layout/pos.tsx`

---

### 1.5 Re-Print Approval Flow — HIGH PRIORITY

**FRD §2.11:** "Tombol Re-print Invoice terkunci dan memunculkan pop-up permintaan otorisasi ke Supervisor (Area Manager) sebelum printer menyala."

**Current:** `RecentOrdersPanel` has a reprint button that calls `handleReprint` directly — no approval gate.

**Implementation:**

1. **Create `printRequests` table** (already exists in schema!):

   ```ts
   export const printRequests = pgTable("print_requests", {
     id: uuid("id").defaultRandom().primaryKey(),
     orderId: uuid("order_id")
       .notNull()
       .references(() => orders.id),
     requestType: text("request_type").notNull(), // "reprint" | "bill"
     requestedBy: uuid("requested_by")
       .notNull()
       .references(() => users.id),
     approvedBy: uuid("approved_by").references(() => users.id),
     status: printRequestStatusEnum("status").notNull().default("Pending"),
     createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
     approvedAt: timestamp("approved_at", { mode: "date" }),
   });
   ```

2. **New server functions:**
   - `requestReprint` (POST) — creates a `printRequests` row with status "Pending"
   - `approveReprint` (POST) — Area Manager approves, updates status to "Approved", returns order data
   - `getPendingPrintRequests` (GET) — for Area Manager dashboard

3. **POS UI flow:**
   - Cashier clicks "🖨️" on a past order
   - System creates a print request (shows "Menunggu persetujuan Area Manager")
   - Area Manager sees notification → clicks "Approve"
   - POS auto-receives approval via polling → triggers actual print

4. **Area Manager page:** `/approval` or integrate into existing dashboard showing pending print requests, cancel requests, and stock transfer approvals.

**Files:** `src/lib/server/pos.ts`, `src/routes/_layout/pos.tsx`, new approval page

---

### 1.6 Bundling Parent-Child Logic — HIGH PRIORITY

**FRD §2.9:** "Menu Paket (Parent SKU) tidak memiliki stok mandiri, melainkan memotong stok dari Menu Satuan (Child SKU)."

**Current:** `recipeChildRecipes` table exists in schema but `createOrder` NEVER uses it. It only deducts `recipeIngredients` for the parent recipe.

**Implementation:**

In `createOrder`, after getting ingredients for the parent recipe, also get child recipes and their ingredients:

```ts
// For each item in the order:
const childLinks = await db
  .select({
    childRecipeId: recipeChildRecipes.childRecipeId,
    quantity: recipeChildRecipes.quantity,
  })
  .from(recipeChildRecipes)
  .where(eq(recipeChildRecipes.parentRecipeId, item.recipeId));

const allIngredientsToDeduct = [];

// Parent recipe's own ingredients
const parentIngs = await db
  .select()
  .from(recipeIngredients)
  .where(eq(recipeIngredients.recipeId, item.recipeId));
for (const ing of parentIngs) {
  allIngredientsToDeduct.push({
    ingredientId: ing.ingredientId,
    quantity: ing.quantity * item.quantity,
  });
}

// Child recipes' ingredients
for (const link of childLinks) {
  const childIngs = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, link.childRecipeId));
  for (const ing of childIngs) {
    allIngredientsToDeduct.push({
      ingredientId: ing.ingredientId,
      quantity: ing.quantity * link.quantity * item.quantity,
    });
  }
}

// Deduct allIngredientsToDeduct from inventory
// (same logic as current, but using the merged list)
```

Also update `getPosMenu` to include `isBundle` flag and `childRecipes` data for display:

```ts
// In getPosMenu return:
return result.map((r) => ({
  ...r,
  isBundle: childLinks.some(c => c.parentRecipeId === r.id),
  childRecipes: childLinks
    .filter(c => c.parentRecipeId === r.id)
    .map(c => ({
      recipeId: c.childRecipeId,
      quantity: c.quantity,
      name: /* lookup from recipes */,
    })),
}));
```

**Files:** `src/lib/server/pos.ts`, `src/routes/_layout/pos.tsx`

---

### 1.7 Add-ons & Modifier BOM — HIGH PRIORITY

**FRD §3.1:** "Modifiers tidak hanya berfungsi sebagai label, tetapi wajib berstatus sebagai SKU komposit yang memiliki BOM sendiri."

**Current:** Modifiers are just labels with prices. They don't deduct any inventory.

**Implementation:**

1. **Schema change:** Add `modifierIngredients` table:

   ```ts
   export const modifierIngredients = pgTable("modifier_ingredients", {
     id: uuid("id").defaultRandom().primaryKey(),
     modifierId: uuid("modifier_id")
       .notNull()
       .references(() => modifiers.id),
     ingredientId: uuid("ingredient_id")
       .notNull()
       .references(() => ingredients.id),
     quantity: integer("quantity").notNull(),
   });
   ```

2. **Seed data:** Map modifiers like "Extra Telur" → `ingredientId` for egg, quantity = 1.

3. **In `createOrder`:** When processing an item with modifiers, also deduct modifier ingredients:

   ```ts
   for (const mod of item.selectedModifiers ?? []) {
     const modIngs = await db
       .select()
       .from(modifierIngredients)
       .where(eq(modifierIngredients.modifierId, mod.modifierId));
     for (const mi of modIngs) {
       // Deduct mi.quantity * item.quantity from inventory
       // Create stock ledger entry
     }
   }
   ```

4. **UI:** In the Modifier Modal, show the ingredient cost implication (optional — can be hidden from cashier).

**Files:** `src/db/schema.ts`, `src/lib/seed/seed-data.ts`, `src/lib/seed/seed.ts`, `src/lib/server/pos.ts`

---

### 1.8 Exclusion Logic (Minus Modifier) — COMPLETION

**FRD §3.2:** "Jika kasir input 'Tanpa Telur', sistem harus mengembalikan/membatalkan potongan 1 butir telur dari BOM."

**Current:** `orderItemExclusions` table exists and is populated in `createOrder`, BUT:

- The inventory is NOT restored when an exclusion is applied
- The COGS calculation doesn't account for exclusions

**Implementation:**

In `createOrder`, after deducting the base recipe ingredients, **add back** (restore) the excluded ingredients:

```ts
// Deduct base ingredients (existing code)
for (const ing of ings) {
  const deductQty = ing.quantity * item.quantity;
  // ... deduct from inventory ...
}

// Restore excluded ingredients
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
    const restoredQty = ex.quantity; // already = exclusion.quantity * item.quantity
    const newQty = inv.quantity + restoredQty;
    await db
      .update(inventory)
      .set({ quantity: newQty, lastUpdated: new Date() })
      .where(eq(inventory.id, inv.id));

    await db.insert(stockLedger).values({
      branchId: data.branchId,
      ingredientId: ex.ingredientId,
      type: "IN",
      quantity: restoredQty,
      balance: newQty,
      reference: order.id,
      notes: `Exclusion restore: ${ex.reason ?? "Tanpa " + ex.ingredientId}`,
    });
  }
}
```

Also adjust COGS: subtract the cost of excluded ingredients from `totalCogs`.

**Files:** `src/lib/server/pos.ts`

---

### 1.9 Historical COGS Snapshot — HIGH PRIORITY

**FRD §4.6:** "Saat transaksi POS selesai, sistem wajib menyimpan 'Snapshot/Copy' dari nilai HPP item tersebut ke tabel riwayat transaksi."

**Current:** `cogsAtTransaction` column exists in `orderItems` but is **never populated** (always 0).

**Implementation:**

In `createOrder`, when creating each `orderItem`, calculate and store the COGS at transaction time:

```ts
const [orderItem] = await db
  .insert(orderItems)
  .values({
    orderId: order.id,
    recipeId: item.recipeId,
    brandId: item.brandId,
    quantity: item.quantity,
    price: item.price,
    cogsAtTransaction: Math.round(totalCogsForThisItem / item.quantity), // per-unit COGS snapshot
    notes: item.notes,
  })
  .returning();
```

Where `totalCogsForThisItem` = sum of (ingredient.averageCost _ ingredient.quantity _ item.quantity) for all ingredients (including modifier ingredients, excluding restored exclusion ingredients).

This ensures that future HPP changes do NOT retroactively affect past transaction profitability.

**Files:** `src/lib/server/pos.ts`

---

### 1.10 Single Base Pricing (Bottom Price) — MEDIUM PRIORITY

**FRD §1.9:** "Sistem menggunakan satu harga dasar (Bottom Price) yang disamakan untuk seluruh tipe pesanan."

**Current:** All channels use the same `basePrice` from the recipe table. This is already effectively a "bottom price."

**Gap:** The `recipes` table has only one price field. The FRD mentions there should be NO mark-up for online channels. The current implementation already uses `basePrice` for all channels, so this is **implicitly done**. However, if the old prototype had different prices per channel, that would need to be removed.

**Action:** Verify that `basePrice` is used uniformly. No schema change needed.

---

## Module 2: Inventory & Deep Inventory

### 2.1 Pagination, Search, Filter on Inventory Pages — HIGH PRIORITY

**FRD §3.3:** "Setiap halaman inventaris dan Stock Ledger wajib menggunakan Pagination (10-15 item per halaman). Terdapat Search Bar dan Sortir."

**Current:** `getInventory` and `getStockLedger` return ALL records with no pagination, no search, no sort.

**Implementation:**

Update server functions to accept pagination params:

```ts
export const getInventory = createServerFn({ method: "GET" })
  .inputValidator((data: {
    branchId: string;
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    sortBy?: "name" | "quantity" | "lastUpdated";
    sortOrder?: "asc" | "desc";
  }) => data)
  .handler(async ({ data }) => {
    const limit = data.limit ?? 15;
    const offset = (data.page ?? 0) * limit;

    const conditions = [eq(inventory.branchId, data.branchId)];
    if (data.category) conditions.push(eq(ingredients.category, data.category));
    if (data.search) {
      conditions.push(
        or(
          like(ingredients.name, `%${data.search}%`),
          like(ingredients.code, `%${data.search}%`),
        ),
      );
    }

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

Add filter categories: "Dry (Kering)", "Fresh (Segar)", "Packaging (Kemasan)", "Bahan Baku".

**Files:** `src/lib/server/inventory.ts`, `src/routes/_layout/inventory/index.tsx`, `src/routes/_layout/inventory/ledger.tsx`

---

### 2.2 Blind Stock Opname — HIGH PRIORITY

**FRD §4.4.2:** "Layar POS/Backoffice HANYA menampilkan daftar nama Item dan kolom input Qty kosong. Sistem dilarang menampilkan 'Ekspektasi Stok Sistem'."

**Current:** `src/routes/_layout/stock-opname/index.tsx` — need to check if it shows expected values.

**Implementation:**

In the stock opname submission form:

- For **Branch Admin** and **Admin Pusat**: Show ONLY item name + empty qty input. Hide "Ekspektasi" column.
- For **Super Admin** and **Area Manager**: Show item name + expected qty + actual qty input.

This requires passing the user role to the component and conditionally rendering columns.

Also: "Form SO tidak boleh di-submit dalam keadaan kosong (Blank Submit)." — validate that ALL items have a qty input before submit.

**Files:** `src/routes/_layout/stock-opname/index.tsx`

---

### 2.3 BOM Cost Roll-Up — HIGH PRIORITY

**FRD §1.6:** "Jika harga bahan baku naik, sistem wajib otomatis menghitung ulang HPP semua resep yang menggunakan bahan tersebut."

**Current:** No automatic roll-up. `averageCost` on ingredients changes, but recipes don't recalculate.

**Implementation:**

Create a server function `recalculateRecipeCosts(recipeId?: string)`:

```ts
async function recalculateRecipeCosts(recipeId?: string) {
  const targetRecipes = recipeId
    ? [recipeId]
    : (await db.select({ id: recipes.id }).from(recipes)).map((r) => r.id);

  for (const rid of targetRecipes) {
    const ings = await db
      .select({
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        averageCost: ingredients.averageCost,
      })
      .from(recipeIngredients)
      .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, rid));

    const totalCogs = ings.reduce((sum, i) => sum + (i.averageCost ?? 0) * i.quantity, 0);

    await db.update(recipes).set({ totalCogs }).where(eq(recipes.id, rid));
  }
}
```

Call this:

1. After `createSupplierDelivery` (when ingredient cost changes)
2. After `updateIngredient` (when averageCost is manually updated)
3. After `receiveDeliveryNote` (when items arrive and costs are updated)

Add `totalCogs` column to `recipes` table if not present.

**Files:** `src/lib/server/recipes.ts`, `src/lib/server/ingredients.ts`, `src/lib/server/scm.ts`, `src/lib/server/supplier-deliveries.ts`

---

### 2.4 Yield Costing Formula — MEDIUM PRIORITY

**FRD §5.1:** "Sistem menghitung ulang HPP produk matang berdasarkan berat akhir aktual setelah penyusutan."

**Current:** `yieldConversions` table exists but no costing formula is implemented.

**Implementation:**

In `createYieldConversion` server function:

```ts
// After creating the yield conversion:
// rawMaterialCost = total cost of raw material used
// finishedQuantity = quantity of finished good produced
// newCostPerUnit = rawMaterialCost / finishedQuantity

const rawMaterialCost = rawInputQty * rawMaterial.averageCost;
const newCostPerUnit = Math.round(rawMaterialCost / finishedOutputQty);

await db
  .update(ingredients)
  .set({ averageCost: newCostPerUnit })
  .where(eq(ingredients.id, finishedGoodId));

// Then recalculate all recipes using this finished good
await recalculateRecipeCosts();
```

**Files:** `src/lib/server/yield.ts`

---

### 2.5 Smart Reordering — MEDIUM PRIORITY

**FRD §5.3:** "Formula: (Rata-rata keluar stok per hari) × 5 hari. Hasil dibulatkan ke atas sesuai MOQ."

**Current:** ROP/ROQ fields exist on ingredients but are never calculated automatically.

**Implementation:**

Create a scheduled function (or manual trigger) that calculates average daily usage:

```ts
async function calculateSmartReorder(ingredientId: string, branchId: string) {
  // Get total OUT quantity from stockLedger for last 30 days
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
  const recommendedQty = Math.ceil(avgDaily * 5); // 5 days lead time

  // Round up to MOQ
  const [ing] = await db
    .select()
    .from(ingredients)
    .where(eq(ingredients.id, ingredientId))
    .limit(1);
  const moq = ing?.moq ?? 1;
  const roundedQty = Math.ceil(recommendedQty / moq) * moq;

  // Update ROP (reorder point) and ROQ (reorder quantity)
  await db
    .update(ingredients)
    .set({ rop: Math.ceil(avgDaily * 3), roq: roundedQty }) // 3 days = reorder point
    .where(eq(ingredients.id, ingredientId));
}
```

Expose via a button on the Purchase Requisition page: "Generate Rekomendasi".

**Files:** `src/lib/server/inventory.ts`, `src/routes/_layout/purchase-requisitions/index.tsx`

---

## Module 3: Master Data & Configuration

### 3.1 Device/Session Restriction — MEDIUM PRIORITY

**FRD §2:** "1 akun Branch Admin hanya memiliki 1 sesi login aktif. Jika login di perangkat baru, perangkat lama otomatis ter-logout."

**Current:** No session management. better-auth handles sessions but doesn't restrict to 1 active session per user.

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

2. On login (including PIN login), invalidate all other sessions for this user.

3. On every API call, update `lastActiveAt`. If a request comes from an invalidated session, return 401.

This requires extending better-auth's session plugin or using a custom hook.

**Files:** `src/db/schema.ts`, `src/lib/auth.ts`, `src/lib/auth-plugins/pin-auth.ts`

---

### 3.2 Dynamic Tax Rate per Branch — MEDIUM PRIORITY

**FRD §2.3:** "PB1 dapat diatur menjadi '0' per cabang."

**Implementation:**

Add `pb1Rate` to branches:

```ts
pb1Rate: integer("pb1_rate").notNull().default(11), // percentage 0-100
```

In POS loader, fetch the branch's PB1 rate:

```ts
const branch = await getBranch({ data: { id: activeBranchId } });
const pb1Rate = branch?.pb1Rate ?? 11;
```

In cart calculations:

```ts
const taxAmount = useMemo(() => {
  if (!pb1Enabled || pb1Rate === 0) return 0;
  return Math.round(subtotalAfterDiscount * (pb1Rate / 100));
}, [pb1Enabled, pb1Rate, subtotalAfterDiscount]);
```

**Files:** `src/db/schema.ts`, `src/lib/server/branches.ts`, `src/routes/_layout/pos.tsx`

---

## Module 4: Waste & Shrinkage

### 4.1 Waste Categorization Enforcement — MEDIUM PRIORITY

**FRD §5.1:** "Input pengurangan stok HANYA BISA menggunakan 3 kategori: Beban Makan, Biaya Operasional, Spoiled."

**Current:** The `wasteCategoryEnum` already has these 3 values. The UI might already enforce this.

**Gap:** Need to verify that:

1. The dropdown only shows these 3 options
2. "Expired" category is removed/hidden
3. Waste entries with "Biaya Operasional" auto-link to Broken Stock

**Files:** `src/routes/_layout/waste/index.tsx`, `src/routes/_layout/waste/broken-stock.tsx`

---

## Module 5: Supply Chain & SCM

### 5.1 PR with Smart Reorder Recommendation — MEDIUM PRIORITY

**FRD §4.2.1:** "Form PR wajib memunculkan kolom 'Sisa Stok Aktual' di samping kolom jumlah order."

**Current:** PR form shows ingredients but not current stock.

**Implementation:**

In the PR creation page, fetch current inventory for the branch and display it next to each item:

```tsx
// In PR form:
{
  prItems.map((item) => (
    <div key={item.ingredientId} className="flex items-center gap-3">
      <span>{item.ingredientName}</span>
      <span className="text-xs text-muted-foreground">
        Stok: {branchInventory.find((i) => i.ingredientId === item.ingredientId)?.quantity ?? 0}{" "}
        {item.unit}
      </span>
      <input
        type="number"
        value={item.quantity}
        onChange={(e) => updateQty(item.ingredientId, Number(e.target.value))}
        placeholder="Jumlah order"
      />
      <span className="text-xs text-emerald-600">
        Rekomendasi: {item.roq} {item.unit}
      </span>
    </div>
  ));
}
```

**Files:** `src/routes/_layout/purchase-requisitions/index.tsx`

---

## Module 6: Finance & Reconciliation

### 6.1 Tax Base for Merchant vs Platform Discounts — MEDIUM PRIORITY

**FRD §4.6:** "PB1 dihitung setelah diskon untuk merchant-funded, sebelum diskon untuk platform-funded."

**Current:** Only merchant-funded vouchers exist. No platform-funded discount mechanism.

**Implementation:**

If platform-funded discounts are added later, the tax calculation needs two paths:

```ts
// Merchant-funded discount (current):
const taxableBase = subtotal - merchantDiscount;
const taxAmount = Math.round(taxableBase * (pb1Rate / 100));

// Platform-funded discount (future):
const taxableBase = subtotal; // before any discount
const taxAmount = Math.round(taxableBase * (pb1Rate / 100));
// platformDiscount is deducted from revenue but not from tax base
```

For now, document this in the plan. Implementation can be deferred until platform-funded discounts are introduced.

---

## Module 7: Reporting & Analytics

### 7.1 Server-Side Pagination — MEDIUM PRIORITY

**FRD §6.6:** "Semua tabel wajib menggunakan Server-Side Pagination. DILARANG fetch all."

**Current:** Many pages fetch all data at once (orders, inventory, stock ledger, waste, etc.).

**Implementation:**

Audit every data table in the app and add pagination:

| Page                  | Current               | Target                    |
| --------------------- | --------------------- | ------------------------- |
| Inventory             | fetch all             | 15/page + search + sort   |
| Stock Ledger          | fetch all             | 15/page + date range      |
| Orders                | fetch all (limit 100) | 15/page + filters         |
| Waste                 | fetch all             | 15/page + category filter |
| SCM Invoices          | fetch all             | 15/page + status filter   |
| Delivery Notes        | fetch all             | 15/page + status filter   |
| Purchase Requisitions | fetch all             | 15/page + branch filter   |
| Stock Transfers       | fetch all             | 15/page + status filter   |
| Users                 | fetch all             | 15/page + role filter     |
| System Logs           | fetch all             | 50/page + status filter   |
| Audit Logs            | fetch all             | 50/page + table filter    |

**Files:** Multiple server files + page components

---

## Implementation Priority Order

### Phase 1: Critical (Week 1)

1. **Negative Stock Tolerance** — unblock daily operations
2. **Negative Alert notifications** — Area Manager awareness
3. **Flexible PB1 Tax** — regulatory compliance
4. **Print Bill Button** — daily operational need
5. **Historical COGS Snapshot** — financial accuracy
6. **Exclusion Logic completion** — inventory accuracy

### Phase 2: High (Week 2)

7. **Bundling Parent-Child Logic** — bundle sales
8. **Add-ons & Modifier BOM** — modifier inventory tracking
9. **Re-Print Approval Flow** — fraud prevention
10. **BOM Cost Roll-Up** — auto price updates
11. **Blind Stock Opname** — audit integrity
12. **Pagination on all tables** — performance

### Phase 3: Medium (Week 3)

13. **Smart Reordering** — auto PR suggestions
14. **Yield Costing Formula** — production costing
15. **Device/Session Restriction** — security
16. **Waste categorization enforcement** — compliance
17. **PR with stock indicator** — better UX

---

## Files to Create

| File                                     | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `src/lib/server/approval.ts`             | Print request approval, cancel request approval |
| `src/lib/server/notifications.ts`        | Negative stock alerts, system notifications     |
| `src/lib/server/session.ts`              | Device/session restriction logic                |
| `src/routes/_layout/approvals/index.tsx` | Area Manager approval dashboard                 |

## Files to Modify (Summary)

| File                                                 | Changes                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/db/schema.ts`                                   | `modifierIngredients`, `pb1Rate` on branches, `userSessions`                                                       |
| `src/lib/server/pos.ts`                              | Soft block stock, negative alerts, bundle deduction, modifier BOM, exclusion restore, COGS snapshot, print request |
| `src/lib/server/branches.ts`                         | `pb1Rate` CRUD                                                                                                     |
| `src/lib/server/recipes.ts`                          | BOM cost roll-up trigger                                                                                           |
| `src/lib/server/inventory.ts`                        | Pagination, search, sort, smart reorder                                                                            |
| `src/lib/server/yield.ts`                            | Costing formula                                                                                                    |
| `src/lib/server/ingredients.ts`                      | Roll-up trigger on cost change                                                                                     |
| `src/lib/server/scm.ts`                              | Roll-up trigger on delivery                                                                                        |
| `src/lib/server/supplier-deliveries.ts`              | Roll-up trigger                                                                                                    |
| `src/lib/auth.ts`                                    | Session restriction                                                                                                |
| `src/lib/auth-plugins/pin-auth.ts`                   | Session restriction                                                                                                |
| `src/routes/_layout/pos.tsx`                         | Print bill, PB1 from branch config, reprint approval flow                                                          |
| `src/routes/_layout/inventory/index.tsx`             | Pagination, search, filters                                                                                        |
| `src/routes/_layout/inventory/ledger.tsx`            | Pagination, date range                                                                                             |
| `src/routes/_layout/stock-opname/index.tsx`          | Blind mode for Branch Admin                                                                                        |
| `src/routes/_layout/purchase-requisitions/index.tsx` | Stock indicator, smart reorder button                                                                              |
| `src/routes/_layout/waste/index.tsx`                 | 3-category enforcement                                                                                             |
| `src/routes/_layout/order-history.tsx`               | Pagination, detail modal, reprint (with approval)                                                                  |
| `src/lib/seed/seed-data.ts`                          | Modifier ingredient mappings                                                                                       |
| `src/lib/seed/seed.ts`                               | Seed modifier ingredients                                                                                          |

---

## Verification Checklist

- [ ] `vp check --fix` passes
- [ ] `vp build` succeeds
- [ ] Order with insufficient stock still goes through (soft block)
- [ ] Negative stock creates notification for Area Manager
- [ ] Branch with `pb1Rate = 0` hides PB1 toggle in POS
- [ ] Branch with `pb1Rate = 5` shows "PB1 5%" and calculates correctly
- [ ] Print Bill button prints preliminary bill with "BELUM DIBAYAR" watermark
- [ ] Bundle recipe deducts child recipe ingredients
- [ ] Modifier with BOM deducts modifier ingredients
- [ ] Exclusion modifier restores excluded ingredient quantity
- [ ] `cogsAtTransaction` is populated per order item
- [ ] Re-print triggers approval request; Area Manager approves → print fires
- [ ] Inventory table shows 15 items per page with pagination
- [ ] Branch Admin sees blind SO (no expected values)
- [ ] Super Admin sees full SO with expected values
- [ ] Ingredient cost update triggers recipe cost roll-up
- [ ] Smart reorder calculates avg daily usage × 5 days, rounded to MOQ
