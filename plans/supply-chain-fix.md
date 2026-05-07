# Plan: Supply Chain Module Consolidation & Fixes

## Executive Summary

This plan consolidates fixes across the Supply Chain module based on:

1. **Purchase Orders are unnecessary** — the PR → SJ → Invoice flow is sufficient
2. **Surat Jalan needs a Review modal** (old prototype pattern) for admin_pusat/super_admin on Received status
3. **SCM Invoices need Cancel action** in addition to the existing Pay action

---

## 1. Purchase Orders — Remove from Navigation

### Analysis

The Purchase Order (PO) page at `/purchase-orders` is an intermediate step between Purchase Requisition (PR) and Surat Jalan (SJ) that adds no value in the current simplified workflow:

- PR is created by branch_admin
- PR is processed by area_manager / admin_pusat
- SJ is auto-created from PR (see `plans/purchase-req.md`)
- Invoice SCM is generated from SJ after receipt

The PO table has no meaningful actions (just a list with status badges). The `purchaseOrders` table and `purchaseOrderItems` table can remain in the schema for future use, but the UI page should be hidden.

### Changes Required

#### 1.1 `src/components/Sidebar.tsx`

Remove the "Purchase Order" nav item from the Supply Chain group:

```tsx
// REMOVE this block:
{
  label: "Purchase Order",
  to: "/purchase-orders",
  icon: FileText,
  roles: ["super_admin", "admin_pusat"],
},
```

#### 1.2 (Optional) Delete route files

If fully removing: delete `src/routes/_layout/purchase-orders/` directory (both `index.tsx` and `$poId.tsx`).

If keeping for future use but hidden: just do Step 1.1. The route files won't be reachable without the sidebar link.

### Verification

- [ ] Sidebar no longer shows "Purchase Order"
- [ ] Direct URL `/purchase-orders` still works (if keeping files) or returns 404 (if deleting)
- [ ] `vp check` passes
- [ ] `vp build` passes

---

## 2. Surat Jalan — Add Review Modal

### Analysis

The old prototype had a **"Review SJ"** workflow:

1. When a Delivery Note reaches `"Received"` status
2. `admin_pusat` or `super_admin` sees a **"Review SJ"** button
3. Clicking opens a **read-only review modal** showing all delivery data
4. Admin confirms review → `reviewedByAdminPusat` flips to `true`
5. After review, the button changes to **"Buat Invoice"**

The current code has `reviewedByAdminPusat` in the schema (`src/db/schema.ts:793`) but:

- It is **not selected** in `getDeliveryNotes`
- There is **no review UI**
- There is **no review server function**

### Changes Required

#### 2.1 Server — `src/lib/server/scm.ts`

**A. Add `reviewedByAdminPusat` to `getDeliveryNotes` select:**

```ts
.select({
  id: deliveryNotes.id,
  code: deliveryNotes.code,
  fromBranchId: deliveryNotes.fromBranchId,
  toBranchId: deliveryNotes.toBranchId,
  status: deliveryNotes.status,
  driverName: deliveryNotes.driverName,
  vehicleNumber: deliveryNotes.vehicleNumber,
  purchaseRequisitionId: deliveryNotes.purchaseRequisitionId,
  reviewedByAdminPusat: deliveryNotes.reviewedByAdminPusat,
  receivedBy: deliveryNotes.receivedBy,
  receivedAt: deliveryNotes.receivedAt,
  createdAt: deliveryNotes.createdAt,
  updatedAt: deliveryNotes.updatedAt,
})
```

**B. Add `reviewDeliveryNote` server function:**

```ts
export const reviewDeliveryNote = createServerFn({ method: "POST" })
  .inputValidator((data: { dnId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [dn] = await db
      .select()
      .from(deliveryNotes)
      .where(eq(deliveryNotes.id, data.dnId))
      .limit(1);

    if (!dn) throw new Error("Delivery note not found");
    if (dn.status !== "Received") throw new Error("Only Received SJ can be reviewed");

    await db
      .update(deliveryNotes)
      .set({ reviewedByAdminPusat: true, updatedAt: new Date() })
      .where(eq(deliveryNotes.id, data.dnId));

    await logSystemAction(
      user,
      "Review Delivery Note",
      `SJ "${dn.code}" direview oleh ${user.name}`,
    );

    return { success: true };
  });
```

**C. Add `receivedByName` to `getDeliveryNote` detail query:**

Join with `users` table to get the name of the person who received:

```ts
// In getDeliveryNote, also select:
receivedByName: users.name,
receivedAt: deliveryNotes.receivedAt,
```

#### 2.2 Client — `src/routes/_layout/delivery-notes/index.tsx`

**A. Update DNRow type and columns:**

```tsx
interface DNRow {
  id: string;
  code: string;
  fromBranchId: string;
  toBranchId: string;
  status: "Draft" | "Picking" | "In Transit" | "Received" | "Cancelled";
  driverName: string | null;
  reviewedByAdminPusat: boolean;
  createdAt: Date;
}
```

**B. Add review mutation:**

```tsx
const reviewMutation = useMutation({
  mutationFn: reviewDeliveryNote,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    setReviewSJ(null);
  },
});
```

**C. Update action column to show Review / Buat Invoice buttons:**

```tsx
{
  key: "id",
  header: "",
  width: "w-48",  // Wider to fit buttons
  render: (r) => (
    <div className="flex items-center justify-end gap-1">
      {/* Picking → Ship (admin_pusat / super_admin) */}
      {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Picking" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void shipMutation.mutateAsync({ data: { dnId: r.id } });
          }}
          className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
        >
          <Truck className="h-3 w-3 inline mr-1" />
          Kirim
        </button>
      )}

      {/* Received → Review or Buat Invoice (admin_pusat / super_admin) */}
      {["super_admin", "admin_pusat"].includes(user?.role ?? "") && r.status === "Received" && (
        <>
          {!r.reviewedByAdminPusat ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setReviewSJ(r);
              }}
              className="h-7 px-2 rounded-md bg-amber-500 text-white text-[10px] font-medium flex items-center gap-1"
            >
              <CheckCircle className="h-3 w-3" />
              Review SJ
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void generateInvoiceMutation.mutateAsync({ data: { dnId: r.id } });
              }}
              className="h-7 px-2 rounded-md bg-emerald-600 text-white text-[10px] font-medium flex items-center gap-1"
            >
              <DollarSign className="h-3 w-3" />
              Buat Invoice
            </button>
          )}
        </>
      )}

      <Link
        to="/delivery-notes/$dnId"
        params={{ dnId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  ),
}
```

**D. Add Review Modal:**

```tsx
const [reviewSJ, setReviewSJ] = useState<DNRow | null>(null);

{
  /* Review Modal */
}
<Modal
  open={!!reviewSJ}
  onClose={() => setReviewSJ(null)}
  title={`Review Surat Jalan: ${reviewSJ?.code}`}
  size="lg"
>
  {reviewSJ && (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg">
        <p className="text-sm font-medium text-blue-900">Review Data Surat Jalan</p>
        <p className="text-xs text-blue-700 mt-1">
          Pastikan semua data pengiriman dan penerimaan sudah benar. Setelah di-review, Anda dapat
          membuat Invoice Internal.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase">Rute</p>
          <p className="font-medium">
            {branches.find((b) => b.id === reviewSJ.fromBranchId)?.name ?? reviewSJ.fromBranchId} →{" "}
            {branches.find((b) => b.id === reviewSJ.toBranchId)?.name ?? reviewSJ.toBranchId}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground uppercase">Status</p>
          <Badge variant="success">{reviewSJ.status}</Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Setelah dikonfirmasi, status review akan tercatat dan tombol "Buat Invoice" akan muncul.
      </p>

      <div className="flex gap-2 pt-2">
        <button onClick={() => setReviewSJ(null)} className="flex-1 h-9 rounded-md border text-sm">
          Batal
        </button>
        <button
          onClick={() => {
            if (reviewSJ) {
              void reviewMutation.mutateAsync({ data: { dnId: reviewSJ.id } });
            }
          }}
          disabled={reviewMutation.isPending}
          className="flex-1 h-9 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {reviewMutation.isPending ? "Memproses..." : "Konfirmasi Review"}
        </button>
      </div>
    </div>
  )}
</Modal>;
```

**E. Import missing icons:**

```tsx
import { ArrowRight, Truck, CheckCircle, DollarSign } from "lucide-react";
```

**F. Add `generateInvoiceMutation` for inline invoice creation:**

```tsx
const generateInvoiceMutation = useMutation({
  mutationFn: generateSCMInvoice,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
    void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
  },
});
```

#### 2.3 Client — `src/routes/_layout/delivery-notes/$dnId.tsx`

**A. Add Review button in detail header:**

```tsx
const canReview = dn.status === "Received" && !dn.reviewedByAdminPusat &&
  ["super_admin", "admin_pusat"].includes(user?.role ?? "");
const canGenerateInvoice = dn.status === "Received" && dn.reviewedByAdminPusat &&
  ["super_admin", "admin_pusat"].includes(user?.role ?? "");

// In the header badge area:
<div className="flex items-center gap-3">
  <Badge variant={...}>{dn.status}</Badge>
  {canReview && (
    <button
      onClick={() => handleReview()}
      className="h-9 px-4 rounded-md bg-amber-500 text-white text-sm font-medium"
    >
      Review SJ
    </button>
  )}
  {canGenerateInvoice && (
    <button
      onClick={() => void generateInvoiceMutation.mutateAsync({ data: { dnId: dn.id } })}
      className="h-9 px-4 rounded-md bg-emerald-600 text-white text-sm font-medium"
    >
      Buat Invoice
    </button>
  )}
</div>
```

**B. Show review status badge:**

```tsx
{
  dn.reviewedByAdminPusat && (
    <div className="rounded-md border p-3 bg-emerald-50">
      <p className="text-xs text-emerald-700">
        <CheckCircle className="inline h-3 w-3 mr-1" />
        Direview oleh Admin Pusat
      </p>
    </div>
  );
}
```

#### 2.4 Database

No schema changes needed. `reviewedByAdminPusat` already exists in `deliveryNotes` table.

### Verification

- [ ] `getDeliveryNotes` returns `reviewedByAdminPusat`
- [ ] `reviewDeliveryNote` server function works and flips the flag
- [ ] Received SJ rows show "Review SJ" button for admin_pusat/super_admin
- [ ] Clicking "Review SJ" opens modal with read-only summary
- [ ] After confirming review, button changes to "Buat Invoice"
- [ ] Clicking "Buat Invoice" generates SCM invoice linked to the SJ
- [ ] `vp check` passes
- [ ] `vp build` passes

---

## 3. SCM Invoices — Add Cancel Action

### Analysis

The current SCM Invoice page (`/scm-invoices`) has:

- ✅ "Bayar" button for `Unpaid` invoices
- ❌ No "Batal" (Cancel) button for `Unpaid` invoices
- ❌ Detail page (`$invId.tsx`) has no action buttons at all

Status flow:

```
Unpaid → [Bayar] → Paid
Unpaid → [Batal] → Cancelled
Paid   → (no action)
Cancelled → (no action)
```

### Changes Required

#### 3.1 Server — `src/lib/server/scm.ts`

**Add `cancelSCMInvoice` server function:**

```ts
export const cancelSCMInvoice = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireRole("super_admin", "admin_pusat");

    const [oldInv] = await db
      .select()
      .from(scmInvoices)
      .where(eq(scmInvoices.id, data.id))
      .limit(1);

    if (!oldInv) throw new Error("Invoice not found");
    if (oldInv.status !== "Unpaid") throw new Error("Only Unpaid invoices can be cancelled");

    const [invoice] = await db
      .update(scmInvoices)
      .set({ status: "Cancelled" })
      .where(eq(scmInvoices.id, data.id))
      .returning();

    await logSystemAction(
      user,
      "Cancel SCM Invoice",
      `Invoice SCM "${invoice.code}" dibatalkan oleh ${user.name}`,
    );
    await logAudit(
      user,
      "scmInvoices",
      data.id,
      "STATUS_CHANGE",
      oldInv as Record<string, unknown>,
      invoice as Record<string, unknown>,
    );

    return invoice;
  });
```

#### 3.2 Client — `src/routes/_layout/scm-invoices/index.tsx`

**A. Add cancel mutation:**

```tsx
const cancelMutation = useMutation({
  mutationFn: cancelSCMInvoice,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scm-invoices"] }),
});
```

**B. Update action column to show both Bayar and Batal:**

```tsx
{
  key: "id",
  header: "",
  width: "w-40",
  render: (r) => (
    <div className="flex items-center justify-end gap-1">
      {r.status === "Unpaid" && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void payMutation.mutateAsync({ data: { id: r.id } });
            }}
            className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
          >
            Bayar
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Yakin ingin membatalkan invoice ini?")) {
                void cancelMutation.mutateAsync({ data: { id: r.id } });
              }
            }}
            className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium"
          >
            Batal
          </button>
        </>
      )}
      <Link
        to="/scm-invoices/$invId"
        params={{ invId: r.id }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  ),
}
```

#### 3.3 Client — `src/routes/_layout/scm-invoices/$invId.tsx`

**Add action buttons in detail header:**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { paySCMInvoice, cancelSCMInvoice } from "#/lib/server/scm";

function SCMInvoiceDetailPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const payMutation = useMutation({
    mutationFn: paySCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-invoice", invId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSCMInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scm-invoice", invId] });
      void queryClient.invalidateQueries({ queryKey: ["scm-invoices"] });
    },
  });

  const canAct = invoice.status === "Unpaid" &&
    ["super_admin", "admin_pusat"].includes(user?.role ?? "");

  // In header:
  <div className="flex items-center gap-3">
    <Badge variant={...}>{invoice.status}</Badge>
    {canAct && (
      <>
        <button
          onClick={() => void payMutation.mutateAsync({ data: { id: invoice.id } })}
          disabled={payMutation.isPending}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {payMutation.isPending ? "Memproses..." : "Bayar"}
        </button>
        <button
          onClick={() => {
            if (confirm("Yakin ingin membatalkan invoice ini?")) {
              void cancelMutation.mutateAsync({ data: { id: invoice.id } });
            }
          }}
          disabled={cancelMutation.isPending}
          className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm disabled:opacity-50"
        >
          {cancelMutation.isPending ? "Memproses..." : "Batal"}
        </button>
      </>
    )}
  </div>
```

### Verification

- [ ] `cancelSCMInvoice` server function rejects non-Unpaid invoices
- [ ] `cancelSCMInvoice` requires `super_admin` or `admin_pusat`
- [ ] List page shows both "Bayar" and "Batal" buttons for Unpaid invoices
- [ ] Detail page shows both "Bayar" and "Batal" buttons for Unpaid invoices
- [ ] Cancel action shows confirmation dialog before executing
- [ ] After cancel, status badge changes to "Cancelled" (red)
- [ ] `vp check` passes
- [ ] `vp build` passes

---

## 4. Cross-Cutting Concerns

### 4.1 Role Visibility Matrix (Final)

| Page                  | super_admin                        | admin_pusat                        | area_manager                     | branch_admin                |
| --------------------- | ---------------------------------- | ---------------------------------- | -------------------------------- | --------------------------- |
| Purchase Requisitions | ✅ View all, Process/Reject        | ✅ View all, Process/Reject        | ✅ View assigned, Process/Reject | ✅ Create own, View own     |
| ~~Purchase Orders~~   | ~~❌ Removed~~                     | ~~❌ Removed~~                     | ~~❌ Removed~~                   | ~~❌ Removed~~              |
| Surat Jalan           | ✅ View all, Ship, Review, Invoice | ✅ View all, Ship, Review, Invoice | ✅ View assigned                 | ✅ View own branch, Receive |
| Invoice SCM           | ✅ View all, Pay, Cancel           | ✅ View all, Pay, Cancel           | ✅ View assigned                 | ✅ View own branch          |
| Barang Masuk          | ✅ CRUD                            | ✅ CRUD                            | ❌                               | ❌                          |

### 4.2 Sidebar Navigation (Final State)

Supply Chain group:

1. **Purchase Requisition** — all roles (branch_admin creates, others process)
2. **Surat Jalan** — all roles (branch_admin receives, others ship/review/invoice)
3. **Invoice SCM** — all roles (read-only for branch_admin, pay/cancel for admin+)
4. **Barang Masuk** — super_admin, admin_pusat only

### 4.3 File Inventory

**Files to Modify:**
| File | Change |
|------|--------|
| `src/components/Sidebar.tsx` | Remove Purchase Order nav item |
| `src/lib/server/scm.ts` | Add `reviewDeliveryNote`, `cancelSCMInvoice`; update `getDeliveryNotes` select |
| `src/routes/_layout/delivery-notes/index.tsx` | Add Review modal, Review/Buat Invoice buttons, generateInvoiceMutation |
| `src/routes/_layout/delivery-notes/$dnId.tsx` | Add Review/Buat Invoice buttons, review status badge |
| `src/routes/_layout/scm-invoices/index.tsx` | Add Cancel button, cancelMutation |
| `src/routes/_layout/scm-invoices/$invId.tsx` | Add Pay/Cancel buttons, mutations |

**Files to Optionally Delete:**
| File | Reason |
|------|--------|
| `src/routes/_layout/purchase-orders/index.tsx` | Page no longer needed |
| `src/routes/_layout/purchase-orders/$poId.tsx` | Detail page no longer needed |

---

## 5. Testing Checklist

### Purchase Order Removal

- [ ] Sidebar does not show "Purchase Order"
- [ ] `/purchase-orders` returns 404 or is inaccessible

### Surat Jalan Review

- [ ] Create a DN, ship it, receive it → status becomes "Received"
- [ ] Login as `admin_pusat` → see "Review SJ" amber button on the row
- [ ] Click "Review SJ" → modal opens with read-only summary
- [ ] Click "Konfirmasi Review" → modal closes, row now shows "Buat Invoice" green button
- [ ] Click "Buat Invoice" → invoice generated, linked to this DN
- [ ] Detail page shows "Direview oleh Admin Pusat" badge

### SCM Invoice Cancel

- [ ] Generate invoice from a reviewed DN → status is "Unpaid"
- [ ] List page shows both "Bayar" and "Batal" buttons
- [ ] Detail page shows both "Bayar" and "Batal" buttons
- [ ] Click "Batal" → confirmation dialog → status changes to "Cancelled"
- [ ] Cancelled invoice no longer shows action buttons
- [ ] Paid invoice no longer shows action buttons

### Build

- [ ] `vp check --fix` passes
- [ ] `vp build` succeeds
