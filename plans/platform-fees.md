# Plan: Platform Fees Page Analysis & Fix

## 1. FRD Requirement Analysis

**Does the FRD require a "Platform Fees" admin page?**

**No.** The FRD (Section 4.6 — Workflow Finance) states:

> "MDR (Merchant Discount Rate) Deduction: Sistem keuangan wajib memiliki field persentase komisi per platform (misal: ShopeeFood 20%, Grab 20% + Rp1.000). Omzet Netto harian di dashboard bukan sekadar total penjualan harga mark-up, melainkan: (Total Gross Sales) - (Merchant Diskon) - (Estimasi Potongan MDR Ojol)."

The FRD requires the **system to possess MDR data** for net sales calculations. It does **not** mandate a dedicated admin CRUD page for editing platform fees. The data can be:

- Seeded at setup time (already done in `seedPlatformFees()`)
- Managed directly in the database
- Configured via a general App Settings page (if one exists)

**Conclusion:** The Platform Fees page is a "nice-to-have" admin convenience, not an FRD-mandated feature. If fixing it is low priority, it can be removed from the sidebar and the data can remain seed-only. If retained, it must work correctly.

---

## 2. Error Root Cause Analysis

**Observed Error:**

```
Cannot read properties of null (reading 'id')
```

**Where:** `<PlatformFeesPage>` component at `src/routes/_layout/admin/platform-fees.tsx`

### Primary Root Cause: Loader Failure + Missing Error Boundary

The route loader calls `getPlatformFees()`, which internally calls `requireAuth()`:

```ts
export const getPlatformFees = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth(); // ← THROWS "Unauthorized" if no session
  const result = await db.select().from(platformFees).orderBy(platformFees.channel);
  return result;
});
```

If the user's session is missing, expired, or the auth cookie isn't transmitted properly:

1. `requireAuth()` throws `"Unauthorized"`
2. The route `loader` throws
3. The route has **no `errorComponent`** defined
4. TanStack Router attempts to render the component anyway with invalid loader data
5. `Route.useLoaderData()` returns `null` or `undefined`
6. The component crashes when trying to access `.id` on a null value (either from `keyExtractor` or from `editing!.id`)

### Secondary Causes

| #   | Issue                                                  | Location                           | Impact                                                                                                                                                       |
| --- | ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2a  | `editing!.id` non-null assertion                       | `handleSubmit`                     | If `editing` is null during submit, hard crash                                                                                                               |
| 2b  | No empty-state handling for `fees`                     | DataTable `data={fees}`            | If `fees` is undefined/null, DataTable may crash depending on how `useQuery` behaves after loader failure                                                    |
| 2c  | No `errorComponent` on route                           | Route definition                   | Any loader error becomes an unhandled white-screen crash                                                                                                     |
| 2d  | `useQuery` calls `getPlatformFees()` again client-side | `queryFn: () => getPlatformFees()` | If the client-side server function call lacks auth context, it throws again, potentially causing React Query to enter error state that the UI doesn't handle |

### Why "null reading id" Specifically?

When a TanStack Router loader throws and there's no `errorComponent`, the router's behavior is to pass the error through. However, `Route.useLoaderData()` may return the **error object itself** or `null` in certain edge cases. The component then tries to use this as data:

```tsx
const { fees: initial } = Route.useLoaderData();
// If loaderData is null → destructuring fails or fees is null

// Later:
<DataTable data={fees} keyExtractor={(r) => r.id} />;
// If fees contains a null element or is null → r.id crashes
```

The `{}` and `%s %s` in the error output suggest a template-string logging failure, which happens when React's error boundary catches a thrown primitive or empty error object during the render cycle.

---

## 3. Fix Plan

### Option A: Remove the Page (Recommended if Low Priority)

Since the FRD does not require this page:

1. Remove the sidebar navigation link to `/admin/platform-fees`
2. Keep the `platformFees` table and seed data (required for MDR calculations)
3. Remove the route file `src/routes/_layout/admin/platform-fees.tsx` (optional)
4. MDR data remains functional for order/net-sales calculations

### Option B: Fix the Page (If Retained)

If the page should be kept for admin convenience, apply these fixes in order:

#### Step 1: Add Error Boundary to Route

```tsx
export const Route = createFileRoute("/_layout/admin/platform-fees")({
  component: PlatformFeesPage,
  errorComponent: () => (
    <div className="p-4 text-red-500">
      Gagal memuat data platform fees. Pastikan Anda sudah login.
    </div>
  ),
  loader: async () => {
    const fees = await getPlatformFees();
    return { fees };
  },
});
```

#### Step 2: Defensive Coding in Component

```tsx
function PlatformFeesPage() {
  const loaderData = Route.useLoaderData();
  const initial = loaderData?.fees ?? [];

  const [editing, setEditing] = useState<FeeRow | null>(null);

  const { data: fees } = useQuery({
    queryKey: ["platform-fees"],
    queryFn: () => getPlatformFees(),
    initialData: initial,
  });

  // Guard: ensure fees is always an array
  const safeFees = fees ?? [];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return; // ← Guard against null editing
    const fd = new FormData(e.currentTarget);
    const data = {
      id: editing.id, // ← Removed non-null assertion
      feePercentage: Number(fd.get("feePercentage")),
      fixedFee: Number(fd.get("fixedFee")),
    };
    void updateMutation.mutateAsync({ data });
  };

  return (
    <RoleGuard allowedRoles={["super_admin"]}>
      <DataTable
        columns={columns}
        data={safeFees} // ← Use guarded array
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
      />
      {/* ... */}
    </RoleGuard>
  );
}
```

#### Step 3: Ensure Server Function Handles Auth Gracefully

Optionally, make `getPlatformFees` return an empty array instead of throwing for unauthenticated users (let the RoleGuard handle access control):

```ts
export const getPlatformFees = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await requireAuth();
  } catch {
    return []; // Return empty array; UI will show empty state
  }
  const result = await db.select().from(platformFees).orderBy(platformFees.channel);
  return result;
});
```

**Note:** This is a UX trade-off — empty array hides auth errors. Prefer Step 1 (error boundary) + keeping the throw behavior.

#### Step 4: Disable Client-Side Refetch if Not Needed

Since the loader already fetches data server-side, the `useQuery` client refetch may be redundant and can cause duplicate auth issues:

```tsx
const { data: fees } = useQuery({
  queryKey: ["platform-fees"],
  queryFn: () => getPlatformFees(),
  initialData: initial,
  enabled: false, // ← Don't refetch client-side; rely on loader + invalidateQueries
});
```

Or remove `useQuery` entirely and use loader data directly for this read-heavy admin page.

---

## 4. Verification Checklist

- [ ] Run `vp check` and `vp build` after any changes
- [ ] Test accessing `/admin/platform-fees` while logged in as `super_admin`
- [ ] Test accessing `/admin/platform-fees` while NOT logged in (should show error boundary or redirect, not crash)
- [ ] Test editing a platform fee and verify `updatePlatformFee` mutation succeeds
- [ ] Verify MDR calculations in order creation still work correctly (platformFees table data is still used)

---

## 5. Decision Matrix

| Criteria            | Remove Page                     | Fix Page                     |
| ------------------- | ------------------------------- | ---------------------------- |
| FRD Required?       | No                              | No                           |
| Dev Effort          | 5 min                           | 30 min                       |
| User Value          | Low (data is seed-only)         | Medium (admin can edit MDR)  |
| Risk of Future Bugs | None                            | Low (if fixed properly)      |
| **Recommendation**  | ✅ If focused on FRD compliance | ✅ If admin UX is a priority |
