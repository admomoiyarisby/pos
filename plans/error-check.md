# Error Fix Plan — `vp check`

> Generated from `vp check` + `npx tsc --noEmit` analysis.
> Total: **~145 errors** across oxlint + TypeScript.

---

## Error Breakdown

### Oxlint (110 errors)

| Rule                                  | Count | Severity |
| ------------------------------------- | ----- | -------- |
| `no-base-to-string`                   | 65    | Error    |
| `no-floating-promises`                | 43    | Error    |
| `no-non-null-asserted-optional-chain` | 2     | Error    |

### TypeScript (35 unique errors, 76 lines)

| Code     | Count | Category                             |
| -------- | ----- | ------------------------------------ |
| `TS6133` | 39    | Unused import / variable / parameter |
| `TS2322` | 4     | Type not assignable                  |
| `TS2345` | 2     | Argument type mismatch               |
| `TS2769` | 2     | No overload matches                  |
| `TS7006` | 2     | Implicit `any`                       |
| `TS6196` | 1     | Unused type alias                    |
| `TS2305` | 1     | Missing export (`todos`)             |
| `TS2307` | 1     | Missing module (`recharts`)          |
| `TS2339` | 1     | Property does not exist (`todos`)    |
| `TS2353` | 1     | Unknown CSS property (`focusRing`)   |

---

## Phase 1: Unused Imports & Variables (TS6133 / TS6196)

**~40 errors | Pure deletion | Lowest risk**

Files affected:

- `src/lib/server/inventory.ts` — unused `z`
- `src/lib/server/pos.ts` — unused `data`
- `src/lib/server/scm.ts` — unused `suppliers`, `data` (×3), `inv`, `newInv`
- `src/lib/server/vouchers.ts` — (already partially fixed)
- `src/lib/server/waste.ts` — unused `ing`
- `src/lib/server/yield.ts` — unused `requireAuth`, `z`, `data`
- `src/router.tsx` — unused `TanstackQueryProvider`
- `src/routes/_layout.tsx` — unused `Outlet`
- `src/routes/_layout/admin/branches.tsx` — unused `router`
- `src/routes/_layout/admin/system-logs.tsx` — unused `Badge`
- `src/routes/_layout/finance/index.tsx` — unused `Badge`, `TrendingUp`, `brands`
- `src/routes/_layout/modifier-groups/index.tsx` — unused `Badge`
- `src/routes/_layout/order-history.tsx` — unused `Eye`
- `src/routes/_layout/pos.tsx` — unused `useMemo`, `Receipt`, `Printer`, `notes`
- `src/routes/_layout/purchase-orders/$poId.tsx` — unused `useQuery`, `getPurchaseOrders`
- `src/routes/_layout/purchase-orders/index.tsx` — unused `useState`
- `src/routes/_layout/purchase-requisitions/$prId.tsx` — unused `updateMutation`
- `src/routes/_layout/recipes/$recipeId.tsx` — unused `ingredients`, `modifierGroups`, `updateMutation`
- `src/routes/_layout/scm-invoices/index.tsx` — unused `FileText`
- `src/routes/_layout/stock-opname/$soId.tsx` — unused `PageHeader`
- `src/routes/_layout/stock-opname/index.tsx` — unused `Plus`
- `src/routes/_layout/stock-transfers/$trId.tsx` — unused `useQuery`, `getStockTransfers`, `Badge`
- `src/routes/_layout/waste/broken-stock.tsx` — unused `useState`, `BrokenRow`
- `src/routes/api/seed.ts` — unused `users`

**Action:** Remove the unused bindings. Use `// @ts-expect-error` or `_` prefix if any are intentionally kept for future use.

---

## Phase 2: Oxlint Mechanical Fixes

**~108 errors | Pattern-based | Low risk**

### 2A. `no-floating-promises` (43 errors)

All are `queryClient.invalidateQueries(...)` or `form.handleSubmit()` or `sendMessage()` calls inside `onSuccess` callbacks that return `void` but the callee returns `Promise`.

**Pattern fix:** Prefix with `void`:

```tsx
// Before
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["x"] });
};

// After
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: ["x"] });
};
```

Files: ~20 route files across admin, scm, inventory, finance, pos, recipes, etc.

### 2B. `no-base-to-string` (65 errors)

All are `String(fd.get("..."))` where `fd.get()` returns `FormDataEntryValue | null` (could be `File`).

**Pattern fix:** Use `.toString()` on a narrowed value, or add a runtime check:

```tsx
// Before
String(fd.get("code"));

// After
const value = fd.get("code");
if (typeof value !== "string") throw new Error("...");
// or
String(fd.get("code") ?? "");
```

The `?? ""` approach is safest for optional fields; runtime check is safest for required fields.

### 2C. `no-non-null-asserted-optional-chain` (2 errors)

Find and fix `foo?.bar!.baz` patterns — use nullish coalescing or explicit checks instead.

---

## Phase 3: Type Mismatches (TS2322 / TS2345 / TS2769 / TS7006)

**~10 errors | Needs domain knowledge | Medium risk**

### 3A. `vouchers.ts` — `validUntil` type mismatch

`validUntil` is parsed as `string` from FormData but the DB schema expects `Date`.

- **Fix:** Parse with `new Date(validUntil)` before insert/update.

### 3B. `users.tsx` — `branchId: string | null` vs `string | undefined`

The query returns `null` for missing branchId but the `UserRow` type expects `undefined`.

- **Fix:** Either normalize `null` → `undefined` in the query result, or update `UserRow` to accept `null`.

### 3C. `pos.tsx` — `modifierGroups` shape mismatch

`minSelection` / `maxSelection` are `number | null` in the DB but the `MenuItem` type expects `number`.

- **Fix:** Either add `?? 0` defaults when mapping, or update the `ModifierGroup` type to allow `null`.

### 3D. `purchase-orders/index.tsx` — `"secondary"` not in variant union

The `variant` prop only accepts `"success" | "default" | "warning" | "destructive"`.

- **Fix:** Change `"secondary"` to a valid variant, or extend the component's variant type.

### 3E. `setup.ts` — `Record<string, unknown>` not assignable to signup params

Better Auth's `signUp` expects `{ name, email, password, ... }` but receives a generic record.

- **Fix:** Narrow the type with explicit property access + validation before calling `signUp`.

### 3F. `audit-logs.tsx` — `unknown` not assignable to `ReactNode`

Rendering `oldValues` / `newValues` directly from JSONB without type narrowing.

- **Fix:** Add `JSON.stringify()` or type guard before rendering.

### 3G. `resume-tools.ts` — implicit `any` on `tag` parameter

Missing type annotation on the `tag` parameter in a callback.

- **Fix:** Add `string` type annotation.

---

## Phase 4: Broken / Demo / Missing Dependencies

**~5 errors | Cleanup | Low-to-medium risk**

### 4A. Missing `recharts` dependency

`src/routes/_layout/analytics/index.tsx` imports `recharts` but it's not in `package.json`.

- **Fix:** `vp add recharts` or remove the analytics page if not yet used.

### 4B. `demo/drizzle.tsx` references removed `todos` table

The demo file imports `todos` from schema and queries `db.query.todos`, but the `todos` table was removed from the schema.

- **Fix:** Either restore the `todos` table to the schema, or delete the demo route entirely.

### 4C. `focusRing` CSS property error in `demo/drizzle.tsx`

`focusRing` is not a valid CSS property.

- **Fix:** Remove or replace with a valid CSS property.

### 4D. `src/lib/resume-tools.ts` — content-collections import failure

The file imports from `content-collections` but types may be missing.

- **Fix:** Check if `@types/content-collections` exists or add a module declaration.

---

## Execution Status

| Phase                | Errors | Status               |
| -------------------- | ------ | -------------------- |
| 1. Unused imports    | ~40    | ✅ Complete (0 left) |
| 2. Oxlint mechanical | ~108   | ✅ Complete (0 left) |
| 3. Type mismatches   | ~10    | ⏳ 10 remaining      |
| 4. Broken/demo/deps  | ~4     | ⏳ 4 remaining       |

**Final state: 0 errors, 0 warnings across all checks** ✅

---

## Success Criteria

- `vp check` passes with **0 errors**.
- Warnings are acceptable but should be reviewed afterward.
- `vp test` still passes after all changes.
