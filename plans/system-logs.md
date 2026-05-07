# System Logs & Audit Logs — Comprehensive Implementation Plan

## Context

The current codebase has **two logging tables** already defined in `src/db/schema.ts` and **UI pages** to view them (`/admin/system-logs`, `/admin/audit-logs`), but **nothing writes to them**. Every mutation in every server function is currently invisible.

This plan covers adding **both** `systemLogs` (high-level narrative) and `auditLogs` (low-level field-level diff) to **every CRUD action** across the entire backend.

---

## Table Reference

### `systemLogs`

| Column      | Type            | Notes                                                                     |
| ----------- | --------------- | ------------------------------------------------------------------------- |
| `id`        | uuid            | PK                                                                        |
| `action`    | text            | Short label: `"Create User"`, `"Close Shift"`, `"Approve Stock Opname"`   |
| `detail`    | text            | Human-readable sentence: `"Admin Pusat membuat user Budi (branch_admin)"` |
| `userId`    | uuid FK → users | Who did it                                                                |
| `userName`  | text            | Denormalized name (avoids JOIN for display)                               |
| `status`    | enum            | `"Success"` (default), `"Warning"`, `"Error"`                             |
| `createdAt` | timestamp       | auto                                                                      |

### `auditLogs`

| Column      | Type            | Notes                                                 |
| ----------- | --------------- | ----------------------------------------------------- |
| `id`        | uuid            | PK                                                    |
| `tableName` | text            | e.g. `"users"`, `"branches"`, `"orders"`              |
| `recordId`  | text            | The row UUID                                          |
| `action`    | text            | `"CREATE"`, `"UPDATE"`, `"DELETE"`, `"STATUS_CHANGE"` |
| `oldValues` | jsonb           | Full old row (UPDATE/DELETE only)                     |
| `newValues` | jsonb           | Full new row (CREATE/UPDATE only)                     |
| `userId`    | uuid FK → users | Who did it                                            |
| `ipAddress` | text            | `null` for now (can be added later)                   |
| `createdAt` | timestamp       | auto                                                  |

---

## Step 1: Create Helper Utilities

### File: `src/lib/server/logging.ts` (NEW)

Create a small module with two helpers. Import this in every server module that performs mutations.

```ts
import { db } from "#/db/index";
import { systemLogs, auditLogs } from "#/db/schema";
import type { AppUser } from "./auth";

export async function logSystemAction(
  user: AppUser | null,
  action: string,
  detail: string,
  status: "Success" | "Warning" | "Error" = "Success",
) {
  await db.insert(systemLogs).values({
    action,
    detail,
    userId: user?.id ?? null,
    userName: user?.name ?? "System",
    status,
  });
}

export async function logAudit(
  user: AppUser | null,
  tableName: string,
  recordId: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE",
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    tableName,
    recordId,
    action,
    oldValues: oldValues ?? null,
    newValues: newValues ?? null,
    userId: user?.id ?? null,
  });
}
```

**Usage pattern inside every `createServerFn` handler:**

```ts
import { logSystemAction, logAudit } from "./logging";

// Inside handler:
const user = await requireAuth();

// For CREATE:
const [created] = await db.insert(...).values(...).returning();
await logSystemAction(user, "Create User", `User "${created.name}" (${created.role}) dibuat oleh ${user.name}`);
await logAudit(user, "users", created.id, "CREATE", undefined, created);

// For UPDATE:
const [old] = await db.select().from(table).where(eq(table.id, id)).limit(1);
await db.update(table).set(...).where(eq(table.id, id));
const [updated] = await db.select().from(table).where(eq(table.id, id)).limit(1);
await logSystemAction(user, "Update User", `User "${updated.name}" diperbarui oleh ${user.name}`);
await logAudit(user, "users", id, "UPDATE", old, updated);

// For DELETE:
const [old] = await db.select().from(table).where(eq(table.id, id)).limit(1);
await db.delete(table).where(eq(table.id, id));
await logSystemAction(user, "Delete User", `User "${old.name}" dihapus oleh ${user.name}`);
await logAudit(user, "users", id, "DELETE", old, undefined);
```

---

## Step 2: Per-Module Logging Spec

For every server module below, add **both** `logSystemAction` and `logAudit` calls. GET-only functions do **not** need logging.

### `src/lib/server/auth.ts`

- `getCurrentUser` — no log (GET)
- `requireAuth` — no log (utility)

### `src/lib/server/users.ts`

| Function                     | Action                      | Detail Template                                                            |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `createUser`                 | `"Create User"`             | `User "{name}" ({role}) dibuat oleh {actor}`                               |
| `updateUser`                 | `"Update User"`             | `User "{name}" diperbarui oleh {actor}`                                    |
| `updateUser` (role change)   | `"Update User"` + `Warning` | `Role user "{name}" diubah dari {oldRole} ke {newRole} oleh {actor}`       |
| `updateUser` (PIN change)    | `"Update User PIN"`         | `PIN user "{name}" diperbarui oleh {actor}`                                |
| `updateUser` (status change) | `"Update User Status"`      | `Status user "{name}" diubah dari {oldStatus} ke {newStatus} oleh {actor}` |

Audit: table `"users"`

### `src/lib/server/branches.ts`

| Function       | Action            | Detail Template                                |
| -------------- | ----------------- | ---------------------------------------------- |
| `createBranch` | `"Create Branch"` | `Cabang "{name}" ({code}) dibuat oleh {actor}` |
| `updateBranch` | `"Update Branch"` | `Cabang "{name}" diperbarui oleh {actor}`      |

Audit: table `"branches"`

### `src/lib/server/brands.ts`

| Function      | Action           | Detail Template                          |
| ------------- | ---------------- | ---------------------------------------- |
| `createBrand` | `"Create Brand"` | `Brand "{name}" dibuat oleh {actor}`     |
| `updateBrand` | `"Update Brand"` | `Brand "{name}" diperbarui oleh {actor}` |

Audit: table `"brands"`

### `src/lib/server/ingredients.ts`

| Function           | Action                | Detail Template                                    |
| ------------------ | --------------------- | -------------------------------------------------- |
| `createIngredient` | `"Create Ingredient"` | `Bahan baku "{name}" ({code}) dibuat oleh {actor}` |
| `updateIngredient` | `"Update Ingredient"` | `Bahan baku "{name}" diperbarui oleh {actor}`      |

Audit: table `"ingredients"`

### `src/lib/server/recipes.ts`

| Function       | Action            | Detail Template                          |
| -------------- | ----------------- | ---------------------------------------- |
| `createRecipe` | `"Create Recipe"` | `Resep "{name}" dibuat oleh {actor}`     |
| `updateRecipe` | `"Update Recipe"` | `Resep "{name}" diperbarui oleh {actor}` |

Audit: table `"recipes"` + `"recipeItems"` (log the recipe as parent)

### `src/lib/server/modifier-groups.ts`

| Function              | Action                    | Detail Template                                   |
| --------------------- | ------------------------- | ------------------------------------------------- |
| `createModifierGroup` | `"Create Modifier Group"` | `Modifier group "{name}" dibuat oleh {actor}`     |
| `updateModifierGroup` | `"Update Modifier Group"` | `Modifier group "{name}" diperbarui oleh {actor}` |

Audit: table `"modifierGroups"` + `"modifierOptions"`

### `src/lib/server/vouchers.ts`

| Function        | Action             | Detail Template                            |
| --------------- | ------------------ | ------------------------------------------ |
| `createVoucher` | `"Create Voucher"` | `Voucher "{code}" dibuat oleh {actor}`     |
| `updateVoucher` | `"Update Voucher"` | `Voucher "{code}" diperbarui oleh {actor}` |

Audit: table `"vouchers"`

### `src/lib/server/platform-fees.ts`

| Function            | Action                  | Detail Template                                 |
| ------------------- | ----------------------- | ----------------------------------------------- |
| `updatePlatformFee` | `"Update Platform Fee"` | `Platform fee "{name}" diperbarui oleh {actor}` |

Audit: table `"platformFees"`

### `src/lib/server/inventory.ts`

| Function             | Action                   | Detail Template                                                        |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `triggerStockOpname` | `"Trigger Stock Opname"` | `Stock opname "{code}" dimulai untuk cabang {branchName} oleh {actor}` |
| `submitStockOpname`  | `"Submit Stock Opname"`  | `Stock opname "{code}" disubmit oleh {actor}`                          |
| `approveStockOpname` | `"Approve Stock Opname"` | `Stock opname "{code}" diapprove oleh {actor}`                         |

Audit: table `"stockOpnames"` + `"stockOpnameItems"`

### `src/lib/server/waste.ts`

| Function           | Action                 | Detail Template                                                            |
| ------------------ | ---------------------- | -------------------------------------------------------------------------- |
| `createWasteEntry` | `"Create Waste Entry"` | `Waste entry untuk "{ingredientName}" ({qty} {unit}) dicatat oleh {actor}` |

Audit: table `"wasteEntries"`

### `src/lib/server/yield.ts`

| Function                | Action                      | Detail Template                                 |
| ----------------------- | --------------------------- | ----------------------------------------------- |
| `createYieldConversion` | `"Create Yield Conversion"` | `Yield conversion "{name}" dibuat oleh {actor}` |

Audit: table `"yieldConversions"`

### `src/lib/server/pos.ts`

| Function      | Action           | Detail Template                                                  |
| ------------- | ---------------- | ---------------------------------------------------------------- |
| `openShift`   | `"Open Shift"`   | `Shift dibuka di cabang {branchName} oleh {actor}`               |
| `closeShift`  | `"Close Shift"`  | `Shift ditutup di cabang {branchName} oleh {actor}`              |
| `createOrder` | `"Create Order"` | `Order #{orderNumber} ({channel}) Rp{total} dibuat oleh {actor}` |

Audit: table `"orders"` + `"orderItems"`

### `src/lib/server/finance.ts`

| Function               | Action                     | Detail Template                                               |
| ---------------------- | -------------------------- | ------------------------------------------------------------- |
| `createManualRevenue`  | `"Create Manual Revenue"`  | `Manual revenue Rp{amount} ({channel}) dicatat oleh {actor}`  |
| `createChannelRevenue` | `"Create Channel Revenue"` | `Channel revenue Rp{amount} ({channel}) dicatat oleh {actor}` |
| `openPeriod`           | `"Open Period"`            | `Periode "{periodName}" dibuka oleh {actor}`                  |
| `closePeriod`          | `"Close Period"`           | `Periode "{periodName}" ditutup oleh {actor}`                 |

Audit: table `"revenues"`, `"periodLogs"`

### `src/lib/server/scm.ts`

| Function                    | Action                          | Detail Template                                        |
| --------------------------- | ------------------------------- | ------------------------------------------------------ |
| `createPurchaseRequisition` | `"Create Purchase Requisition"` | `PR "{code}" dibuat oleh {actor}`                      |
| `updatePurchaseRequisition` | `"Update Purchase Requisition"` | `PR "{code}" status diubah ke {status} oleh {actor}`   |
| `createPurchaseOrder`       | `"Create Purchase Order"`       | `PO "{code}" dibuat oleh {actor}`                      |
| `createDeliveryNote`        | `"Create Delivery Note"`        | `SJ "{code}" dibuat oleh {actor}`                      |
| `shipDeliveryNote`          | `"Ship Delivery Note"`          | `SJ "{code}" dikirim oleh {actor}`                     |
| `receiveDeliveryNote`       | `"Receive Delivery Note"`       | `SJ "{code}" diterima oleh {actor}`                    |
| `generateSCMInvoice`        | `"Generate SCM Invoice"`        | `Invoice SCM "{code}" (Rp{total}) dibuat oleh {actor}` |
| `paySCMInvoice`             | `"Pay SCM Invoice"`             | `Invoice SCM "{code}" dibayar oleh {actor}`            |
| `createStockTransfer`       | `"Create Stock Transfer"`       | `Mutasi stok "{code}" dibuat oleh {actor}`             |
| `approveStockTransfer`      | `"Approve Stock Transfer"`      | `Mutasi stok "{code}" diapprove oleh {actor}`          |

Audit: tables `"purchaseRequisitions"`, `"purchaseOrders"`, `"deliveryNotes"`, `"scmInvoices"`, `"stockTransfers"`

### `src/lib/server/supplier-deliveries.ts`

| Function                 | Action                       | Detail Template                                                                    |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| `createSupplierDelivery` | `"Create Supplier Delivery"` | `Barang masuk dari "{supplierName}" ({ingredientName} {qty}) dicatat oleh {actor}` |
| `updateSupplierDelivery` | `"Update Supplier Delivery"` | `Barang masuk "{id}" diperbarui oleh {actor}`                                      |
| `deleteSupplierDelivery` | `"Delete Supplier Delivery"` | `Barang masuk "{id}" dihapus oleh {actor}`                                         |

Audit: table `"supplierDeliveries"`

### `src/lib/server/system.ts`

| Function                   | Action                         | Detail Template                                                    |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `markNotificationRead`     | `"Mark Notification Read"`     | `Notifikasi dibaca oleh {actor}`                                   |
| `createSystemNotification` | `"Create System Notification"` | `Notifikasi "{title}" dibuat untuk user {targetUser} oleh {actor}` |

Audit: table `"systemNotifications"` (skip for mark-read, it's too noisy)

---

## Step 3: Auth Action Logging

### File: `src/lib/auth-plugins/pin-auth.ts`

Inside the `signInWithPin` endpoint handler, after successful session creation, add:

```ts
await db.insert(systemLogs).values({
  action: "PIN Login",
  detail: `User "${userData.name}" (${userData.role}) login via PIN`,
  userId: userData.id,
  userName: userData.name,
});
```

This requires importing `db` and `systemLogs` into the auth plugin file (already imports `db` in current version).

---

## Step 4: Error Logging

For mutations that **fail** (throw errors), catch and log with `"Error"` status **before** re-throwing. This is optional but recommended for critical paths.

Pattern:

```ts
try {
  // ... mutation logic ...
} catch (err) {
  await logSystemAction(
    user,
    "Create Order",
    `Gagal membuat order: ${err instanceof Error ? err.message : "Unknown error"}`,
    "Error",
  );
  throw err;
}
```

**Priority modules for error logging** (highest impact):

- `pos.ts` — `createOrder` (revenue-critical)
- `finance.ts` — `openPeriod`, `closePeriod` (accounting-critical)
- `inventory.ts` — `approveStockOpname` (inventory-critical)

---

## Step 5: GET Functions — No Logging Required

The following functions are read-only and **do NOT** need system/audit logs:

- All `get*`, `get*List`, `get*Detail`, `get*Summary` functions
- Dashboard data endpoints
- Analytics endpoints
- Menu/lookup endpoints

---

## Step 6: Implementation Order (Suggested)

Work module-by-module to stay organized:

1. **Foundation**: Create `src/lib/server/logging.ts`
2. **Auth**: `pin-auth.ts` (single line)
3. **Users**: `users.ts` (most important — admin actions)
4. **POS**: `pos.ts` (revenue-critical)
5. **Finance**: `finance.ts` (accounting-critical)
6. **Inventory**: `inventory.ts` + `waste.ts` + `yield.ts`
7. **SCM**: `scm.ts` + `supplier-deliveries.ts`
8. **Master Data**: `branches.ts` + `brands.ts` + `ingredients.ts` + `recipes.ts` + `modifier-groups.ts`
9. **Marketing**: `vouchers.ts` + `platform-fees.ts`
10. **System**: `system.ts`

---

## Step 7: Verification Checklist

After implementation, verify:

- [ ] `vp check --fix` passes with zero errors
- [ ] `vp build` succeeds
- [ ] Create a user → check `/admin/system-logs` shows `"Create User"` entry
- [ ] Update a branch → check `/admin/audit-logs` shows old/new JSON diff
- [ ] Create a POS order → check both logs tables
- [ ] PIN login → check `"PIN Login"` entry in system logs
- [ ] Delete any record → check `"DELETE"` audit log with `oldValues` populated
- [ ] All system log entries show correct `userName` (not null)
- [ ] All audit log entries show correct `tableName` and `recordId`

---

## Files to Create

| File                        | Purpose                                      |
| --------------------------- | -------------------------------------------- |
| `src/lib/server/logging.ts` | `logSystemAction()` and `logAudit()` helpers |

## Files to Modify (18 files)

| File                                    | # of Functions to Add Logs                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `src/lib/server/users.ts`               | 2 (`createUser`, `updateUser`)                                                   |
| `src/lib/server/branches.ts`            | 2 (`createBranch`, `updateBranch`)                                               |
| `src/lib/server/brands.ts`              | 2 (`createBrand`, `updateBrand`)                                                 |
| `src/lib/server/ingredients.ts`         | 2 (`createIngredient`, `updateIngredient`)                                       |
| `src/lib/server/recipes.ts`             | 2 (`createRecipe`, `updateRecipe`)                                               |
| `src/lib/server/modifier-groups.ts`     | 2 (`createModifierGroup`, `updateModifierGroup`)                                 |
| `src/lib/server/vouchers.ts`            | 2 (`createVoucher`, `updateVoucher`)                                             |
| `src/lib/server/platform-fees.ts`       | 1 (`updatePlatformFee`)                                                          |
| `src/lib/server/inventory.ts`           | 3 (`triggerStockOpname`, `submitStockOpname`, `approveStockOpname`)              |
| `src/lib/server/waste.ts`               | 1 (`createWasteEntry`)                                                           |
| `src/lib/server/yield.ts`               | 1 (`createYieldConversion`)                                                      |
| `src/lib/server/pos.ts`                 | 3 (`openShift`, `closeShift`, `createOrder`)                                     |
| `src/lib/server/finance.ts`             | 4 (`createManualRevenue`, `createChannelRevenue`, `openPeriod`, `closePeriod`)   |
| `src/lib/server/scm.ts`                 | 10 (all mutation functions)                                                      |
| `src/lib/server/supplier-deliveries.ts` | 3 (`createSupplierDelivery`, `updateSupplierDelivery`, `deleteSupplierDelivery`) |
| `src/lib/server/system.ts`              | 2 (`markNotificationRead`, `createSystemNotification`)                           |
| `src/lib/auth-plugins/pin-auth.ts`      | 1 (after successful PIN login)                                                   |

**Total: ~43 mutation functions across 17 server modules + 1 auth plugin**
