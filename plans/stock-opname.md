# Stock Opname: Trigger → Redirect to Detail Page

## Problem

In the prototype (`omoiyari_pos/src/App.tsx`), the Stock Opname flow is a single monolithic component (`StockOpnameView`) where:

1. User selects a branch on **Step 1**
2. Clicks "Mulai Opname" → sets `step = 2`
3. **Step 2** immediately renders the SO form with items fetched from inventory
4. User fills physical stock, clicks "Submit Opname" → saves to state

In the production TanStack Router version (`omoiyari-pos`), this is split across two routes:

- **`/stock-opname/`** — lists existing SOs, has "Trigger SO" button that opens a modal
- **`/stock-opname/$soId`** — shows the detail page with the SO form

**Current gap**: After the user clicks "Trigger SO" and the mutation succeeds, nothing happens. The modal just closes (`onSuccess: setTriggerModal(false)`) and the user stays on the list page. There is no redirect to the newly created SO detail page.

---

## Prototype Behavior (reference)

In the prototype (`App.tsx` line 4870–4924):

```tsx
const startOpname = () => {
  // 1. Inventory filtering & item prep
  setOpnameItems(...);
  // 2. Immediate in-component navigation
  setStep(2);
};

const submitOpname = () => {
  const newOpname = { ... };
  onOpnameSubmitted(newOpname);  // pushes to parent state
  alert("Stock Opname berhasil disubmit...");
  setStep(1);  // back to list
};
```

The prototype creates the SO items inline and navigates via internal state (`step`). The production version needs to redirect via TanStack Router after the server creates the SO.

---

## Implementation Plan

### Task 1: Capture Created SO ID and Redirect

**File**: `src/routes/_layout/stock-opname/index.tsx`

**Current code** (lines 98–104):

```ts
const triggerMutation = useMutation({
  mutationFn: triggerStockOpname,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
    setTriggerModal(false);
  },
});
```

**Fix**: The `triggerStockOpname` server function already returns the created SO object (`return so;` — the `[so]` row from `db.insert(...).returning()`). Use it to navigate:

1. Import `useRouter` from `@tanstack/react-router`
2. Change `onSuccess` callback to receive the result (the created SO object) and navigate:

```ts
const router = useRouter();
const navigate = useNavigate({ from: Route.fullPath });

const triggerMutation = useMutation({
  mutationFn: triggerStockOpname,
  onSuccess: (createdSo) => {
    void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
    void navigate({ to: "/stock-opname/$soId", params: { soId: createdSo.id } });
  },
});
```

This gives the same flow as the prototype: trigger → immediate redirect to the SO detail form.

### Task 2: Handle `triggerStockOpname` Return Type Typing

The `triggerStockOpname` server function returns the created SO row from Drizzle (with fields: `id`, `branchId`, `date`, `status`, `triggeredBy`, `submittedBy`, `createdAt`). React Query's `onSuccess` callback receives `TData`. Since `triggerStockOpname` is typed to return the Drizzle row, no additional typing is needed — just `createdSo.id`.

### Task 3: Auto-populate `physicalInputs` on Detail Page Load

**File**: `src/routes/_layout/stock-opname/$soId.tsx`

Currently the detail page initializes `physicalInputs` as empty `{}`. When the user arrives from the redirect (freshly triggered SO), all items have `physicalStock: 0`. This is fine for **blind SO** (branch admin / admin_pusat) since `systemStock` is hidden. But for **non-blind SO** (super_admin / area_manager), the user should see the system stock column for reference.

No change needed here — the existing code reads `physicalInputs[item.id] ?? (item.physicalStock > 0 ? String(item.physicalStock) : "")`. For a new SO, `physicalStock` is 0, so inputs start empty. This is correct behavior for blind SO. For non-blind SO, the user can refer to the visible "Stok Sistem" column.

---

## File Changes

### `src/routes/_layout/stock-opname/index.tsx`

**Add imports**:

```ts
import { useRouter, useNavigate } from "@tanstack/react-router";
```

**Change `onSuccess`** in `triggerMutation` (lines 100–103):

```ts
const router = useRouter();
const navigate = useNavigate({ from: Route.fullPath });

const triggerMutation = useMutation({
  mutationFn: triggerStockOpname,
  onSuccess: (result) => {
    void queryClient.invalidateQueries({ queryKey: ["stock-opnames"] });
    void navigate({ to: "/stock-opname/$soId", params: { soId: result.id } });
  },
});
```

**Remove** the `setTriggerModal(false)` from `onSuccess` (navigation replaces the need). The modal will be unmounted as the page navigates away.

---

## Edge Cases & Pitfalls

### 1. Navigation from modal context

The user triggers SO from a modal, and the redirect happens before the modal closes. This is fine — TanStack Router navigation unmounts the modal component entirely.

### 2. Double-trigger protection

If the user double-clicks "Trigger SO", React Query deduplicates in-flight mutations (or the `disabled` state on the button prevents this). The current code has `disabled={triggerMutation.isPending}` on the trigger button.

### 3. Branch filtering

Only users with `super_admin`, `admin_pusat`, or `area_manager` roles can trigger SO (checked by `requireRole` in the server fn). The UI gate (`canTrigger` variable) matches this.

### 4. Branch admin view

Branch admins cannot trigger SO themselves (only fill it in). They arrive at the detail page when an AM/Super Admin triggers SO for their branch. The redirect flow doesn't involve branch admins.

### 5. Loader cache

The `/stock-opname/$soId` page uses `getStockOpnameDetail` in its loader. After the redirect, it will fetch the newly created SO and its items from the database.

---

## Verification Steps

1. As area_manager, trigger SO for a branch → should redirect to `/stock-opname/{newId}` detail page
2. See SO form with item list, system stock visible (non-blind for AM)
3. Fill physical stock values, submit → status changes to "Submitted"
4. As branch_admin, navigate to the SO detail page → should see blind SO (no system stock column)
5. As area_manager, approve SO with a note → stock updates, SO status becomes "Approved"
