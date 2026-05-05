# Error Check Results — Fix Plan

`vp check --fix` found **33 errors** and **25 warnings** in 129 files. This plan maps each issue to its root cause and the exact fix required.

---

## Error 1: `usePageTitle()` returns `void`, cannot be used in JSX expression position

| File                                       | Line | Issue                                                              |
| ------------------------------------------ | ---- | ------------------------------------------------------------------ |
| `src/routes/_layout/admin/system-logs.tsx` | 87   | `{usePageTitle("System Logs", "...")}` renders `void` as ReactNode |

**Root cause**: The `usePageTitle` hook was inserted inside JSX braces as if it returns a value. It must be called **before** the `return` statement, not inside JSX.

**Fix**: Move the call above the `return`. Same pattern was applied to ~25 other files by a script — some may have the same issue. Check all `_layout/*.tsx` files that have `usePageTitle` inside a `return` JSX block.

```tsx
// BEFORE (broken)
return (
  <RoleGuard>
    {usePageTitle("System Logs", "...")}  // ← void is not ReactNode
    ...

// AFTER (fixed)
usePageTitle("System Logs", "Log operasional sistem");

return (
  <RoleGuard>
    ...
```

**Files to scan**:

```bash
grep -rn "{usePageTitle" src/routes/_layout/ --include="*.tsx"
```

---

## Error 2: Unused imports / variables (TS6133 / no-unused-vars)

### 2a. `src/lib/seed/index.ts` (3 errors)

| Symbol | Status                  |
| ------ | ----------------------- |
| `db`   | imported but never used |
| `eq`   | imported but never used |
| `auth` | imported but never used |

**Fix**: Remove all three imports from `src/lib/seed/index.ts`.

### 2b. `src/lib/server/dashboard.ts` (3 errors)

| Symbol | Status                                     |
| ------ | ------------------------------------------ |
| `gte`  | imported but never used from `drizzle-orm` |
| `lte`  | imported but never used from `drizzle-orm` |
| `sql`  | imported but never used from `drizzle-orm` |

**Fix**: Remove `gte`, `lte`, `sql` from the import list. Keep `eq`, `and`, `desc`, `inArray`.

### 2c. `src/lib/seed/seed.ts` (16 errors)

| Symbol                              | Status               |
| ----------------------------------- | -------------------- |
| `purchaseRequisitionsTable`         | imported, never used |
| `purchaseRequisitionItemsTable`     | imported, never used |
| `purchaseOrdersTable`               | imported, never used |
| `purchaseOrderItemsTable`           | imported, never used |
| `deliveryNotesTable`                | imported, never used |
| `deliveryNoteItemsTable`            | imported, never used |
| `scmInvoicesTable`                  | imported, never used |
| `scmInvoiceItemsTable`              | imported, never used |
| `operationalExpensesTable`          | imported, never used |
| `stockOpnamesTable`                 | imported, never used |
| `stockOpnameItemsTable`             | imported, never used |
| `manualRevenuesTable`               | imported, never used |
| `manualRevenueBrandBreakdownsTable` | imported, never used |
| `channelRevenuesTable`              | imported, never used |
| `periodLogsTable`                   | imported, never used |
| `periodBalancesTable`               | imported, never used |

**Fix**: Remove all 16 unused table imports from `src/lib/seed/seed.ts`. They were imported with aliases in anticipation of future seed functions that were never written. Only keep the tables that are actually used.

**Also**: `allSuccess` parameter on line 607 (`seedOrders`) is never used. Prefix with `_`.

### 2d. `src/routes/_layout/pos.tsx` (1 error)

| Symbol             | Status                                    |
| ------------------ | ----------------------------------------- |
| `activeBranchName` | declared, computed, but never used in JSX |

**Fix**: Either remove the variable entirely, or display it somewhere (e.g. next to the branch `<select>` for admin). The simplest fix is to remove it since `activeBranchName` is computed but only the `<select>` dropdown is rendered.

```tsx
// Remove line 104:
const activeBranchName = allBranches.find((b) => b.id === activeBranchId)?.name ?? "Pilih Cabang";
```

---

## Error 3: Type mismatch in `toggleVoucher` — `v` type from loader data differs from local `Voucher` interface

| File                         | Line | Issue                                                                                               |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `src/routes/_layout/pos.tsx` | 577  | `v` from `allVouchers` has `validUntil: Date` but `Voucher` interface declares `validUntil: string` |

**Root cause**: The loader calls `getVouchers({ data: { activeOnly: true } })` which returns raw DB rows. The DB schema declares `validUntil: timestamp("valid_until", { mode: "date" })`, so `validUntil` is a `Date` object. The local `Voucher` interface declares it as `string`.

**Fix**: Two options:

- **Option A (recommended)**: Update the `Voucher` interface in `pos.tsx` to match the DB type:

  ```ts
  interface Voucher {
    id: string;
    code: string;
    description: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    minOrder: number;
    validUntil: Date; // ← change from string
    isActive: boolean;
  }
  ```

- **Option B**: Import the `vouchers` schema type and use `InferSelectModel` instead of a hand-written interface.

---

## Error 4: `Order` interface missing `status` in `Charts.tsx`

| File                                  | Line | Issue                                            |
| ------------------------------------- | ---- | ------------------------------------------------ |
| `src/components/dashboard/Charts.tsx` | 76   | `Order` interface doesn't have `status` property |
| `src/components/dashboard/Charts.tsx` | 94   | Same issue                                       |

**Root cause**: The local `Order` interface in `Charts.tsx` only defines `id`, `channel`, `totalAmount`, `branchId`, `createdAt`, `brandId`. It's missing `status`. The `computeSalesByBranch` and `computeSalesByBrand` functions filter by `o.status === "Completed"`.

**Fix**: Add `status: string` to the `Order` interface in `src/components/dashboard/Charts.tsx`:

```ts
interface Order {
  id: string;
  channel: string;
  totalAmount: number;
  branchId: string;
  createdAt: Date;
  brandId?: string | null;
  status: string; // ← add this
}
```

---

## Error 5: Recharts `Pie` label prop type mismatch

| File                                  | Line | Issue                                                       |
| ------------------------------------- | ---- | ----------------------------------------------------------- |
| `src/components/dashboard/Charts.tsx` | 187  | `label` callback type doesn't match Recharts' expected type |

**Root cause**: The `label` prop on `<Pie>` receives `{ name, percent }` but Recharts types it differently. The explicit type annotation `{ name: string; percent: number }` conflicts with the library's type.

**Fix**: Remove the explicit type annotation and let inference handle it, or cast:

```tsx
// BEFORE (broken)
label={({ name, percent }: { name: string; percent: number }) =>
  percent > 0.08 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
}

// AFTER (fixed)
label={({ name, percent }: { name: string; percent: number }) =>
  percent > 0.08 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
}
// → actually this might need `as any` or removal of the type annotation
// → try:  label={(p: any) => p.percent > 0.08 ? `${p.name} ${(p.percent * 100).toFixed(0)}%` : ""}
```

Or remove the explicit inline type annotation entirely:

```tsx
label={({ name, percent }: any) => ...}
```

---

## Error 6: Recharts `Tooltip formatter` type mismatch (×3)

| File                                  | Lines | Issue                                                              |
| ------------------------------------- | ----- | ------------------------------------------------------------------ |
| `src/components/dashboard/Charts.tsx` | 195   | `formatter={(value: number) => [value, "Pesanan"]}` type mismatch  |
| `src/components/dashboard/Charts.tsx` | 240   | `formatter={(value: number) => [string, "Revenue"]}` type mismatch |
| `src/components/dashboard/Charts.tsx` | 275   | same as above                                                      |

**Root cause**: Recharts `Tooltip` `formatter` prop has a complex generic type that expects a function returning `ReactNode | [ReactNode, ReactNode]`. The tuple `[number, string]` or `[string, string]` doesn't match the expected type.

**Fix**: Cast the formatter prop to `any` or use `as unknown as Formatter<...>`. The simplest is `as any`:

```tsx
// BEFORE
<Tooltip formatter={(value: number) => [value, "Pesanan"]} />

// AFTER
<Tooltip formatter={((value: number) => [value, "Pesanan"]) as any} />
```

---

## Error 7: `computeDiscrepancies` argument type mismatch

| File                               | Line | Issue                                                  |
| ---------------------------------- | ---- | ------------------------------------------------------ |
| `src/routes/_layout/dashboard.tsx` | 136  | `stockOpnames` has items attached, expected plain type |

**Root cause**: `stockOpnames` returned by `getDashboardData` is mapped with `.map(...)` to add `items` to each opname. But `computeDiscrepancies` expects a `StockOpname[]` where each item is plain (no `items` property). The function itself iterates `so.items` so the type should include `items`.

**Fix**: Update the `StockOpname` interface in `DiscrepancyTable.tsx` to include `items`:

```ts
interface StockOpname {
  id: string;
  branchId: string;
  date: string;
  items: { ingredientId: string; variancePercentage?: number }[];
}
```

Wait — looking at the function `computeDiscrepancies`, it already accesses `so.items`, so the type should already have `items`. The issue is likely that the `stockOpnames` in dashboard.tsx has additional properties. The simplest fix is to cast:

```tsx
const discrepancies = computeDiscrepancies(stockOpnames as any, ingredients, branches);
```

Or, better, update the `StockOpname` interface in `DiscrepancyTable.tsx` to accept the full shape with `status`, `triggeredBy`, etc. (since the data comes from the DB schema).

---

## Warning: Empty file

| File                                        | Issue                              |
| ------------------------------------------- | ---------------------------------- |
| `.content-collections/generated/index.d.ts` | Empty file — unicorn/no-empty-file |

**Fix**: Delete the file or add `// This file is intentionally left empty` comment.

---

## Implementation Order

1. **Fix `usePageTitle` JSX placement** in all `_layout/*.tsx` files
2. **Remove unused imports** (seed files, dashboard server, seed index)
3. **Fix POS type mismatch** (Voucher `validUntil` type)
4. **Fix Charts type errors** (Order interface, Recharts types)
5. **Fix dashboard discrepancy type** (cast or update interface)
6. **Delete/comment empty file**

---

## Quick-fix summary by file

| File                                            | Action                                                       |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `src/lib/seed/index.ts`                         | Remove `db`, `eq`, `auth` imports                            |
| `src/lib/server/dashboard.ts`                   | Remove `gte`, `lte`, `sql` from drizzle-orm import           |
| `src/lib/seed/seed.ts`                          | Remove 16 unused table imports; prefix `_allSuccess`         |
| `src/routes/_layout/pos.tsx`                    | Remove `activeBranchName`; fix `Voucher.validUntil` → `Date` |
| `src/routes/_layout/admin/system-logs.tsx`      | Move `usePageTitle` above `return`                           |
| `src/components/dashboard/Charts.tsx`           | Add `status` to Order interface; fix Recharts type issues    |
| `src/components/dashboard/DiscrepancyTable.tsx` | Expand StockOpname interface or cast in caller               |
| `src/routes/_layout/dashboard.tsx`              | Cast `stockOpnames` to expected type                         |
| `.content-collections/generated/index.d.ts`     | Delete or add placeholder comment                            |

---

## Post-fix verification

After all fixes, run:

```bash
vp check
vp build
```

Both must pass cleanly.
