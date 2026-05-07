# Plan: Purchase Requisition Workflow & Surat Jalan Integration

## Overview

Refactor the Purchase Requisition (PR) page to enforce proper role-based permissions, add row-level action buttons (Process + Reject), and integrate auto-creation of Surat Jalan (Delivery Note) when a PR is processed.

---

## 1. Role Permission Model (Enforce Strictly)

### Current State (Broken)

- All roles (`super_admin`, `admin_pusat`, `area_manager`, `branch_admin`) can see the PR page
- `super_admin` and `admin_pusat` can click "Proses" on any `Pending` PR
- `area_manager` and `branch_admin` cannot act on PRs at all
- `branch_admin` can create PRs for ANY branch (no restriction check in UI)

### Target State

| Role           | Can Create PR          | Can Edit Own PR       | Can Process PR                 | Can Reject PR | Can Create SJ from PR |
| -------------- | ---------------------- | --------------------- | ------------------------------ | ------------- | --------------------- |
| `branch_admin` | ✅ Only for own branch | ✅ Only Draft/Pending | ❌ No                          | ❌ No         | ❌ No                 |
| `area_manager` | ❌ No                  | ❌ No                 | ✅ Yes (for assigned branches) | ✅ Yes        | ✅ Yes                |
| `admin_pusat`  | ❌ No                  | ❌ No                 | ✅ Yes (all branches)          | ✅ Yes        | ✅ Yes                |
| `super_admin`  | ❌ No                  | ❌ No                 | ✅ Yes (all branches)          | ✅ Yes        | ✅ Yes                |

### Files to Modify

#### 1.1 `src/routes/_layout/purchase-requisitions/index.tsx`

**Hide "Buat PR" button** from non-branch-admin users:

```tsx
// Only branch_admin can see the "Buat PR" button
{
  user?.role === "branch_admin" && (
    <PageHeader action={{ label: "Buat PR", onClick: () => setModalOpen(true) }} />
  );
}
```

**Restrict PR create form branch selection** to own branch only:

```tsx
// If branch_admin, pre-fill and lock branch to user's branch
<select
  name="branchId"
  defaultValue={user?.branchId ?? ""}
  disabled={user?.role === "branch_admin"}  // Lock for branch_admin
  // ...
>
```

**Also disable Smart Reordering button for non-branch_admin**:

```tsx
{user?.role === "branch_admin" && (
  <button onClick={...}>Smart Reordering</button>
)}
```

#### 1.2 `src/lib/server/scm.ts` — `createPurchaseRequisition`

Already has branch check — verify it works:

```ts
if (user.role === "branch_admin" && user.branchId !== data.branchId) {
  throw new Error("Unauthorized: can only create PR for your own branch");
}
```

**Add role restriction** to `createPurchaseRequisition`:

```ts
if (!["branch_admin", "super_admin"].includes(user.role)) {
  throw new Error("Forbidden: only branch admin can create PR");
}
```

(Keep `super_admin` as escape hatch for testing/admin purposes.)

#### 1.3 `src/lib/server/scm.ts` — `updatePurchaseRequisition`

Add server-side role validation:

```ts
export const updatePurchaseRequisition = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; status?: string; rejectionReason?: string; approvedBy?: string }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();
    const { id, status } = data;

    const [oldPr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .limit(1);

    if (!oldPr) throw new Error("PR not found");

    // branch_admin can only edit their own PRs if status is Draft/Pending
    if (user.role === "branch_admin") {
      if (oldPr.requestedBy !== user.id) {
        throw new Error("Unauthorized: can only edit your own PR");
      }
      if (status && !["Draft", "Pending"].includes(oldPr.status)) {
        throw new Error("Cannot modify PR that is already processed");
      }
      // branch_admin can only set status to Draft or Pending (not Processed/Rejected)
      if (status && !["Draft", "Pending"].includes(status)) {
        throw new Error("Unauthorized: cannot change to this status");
      }
    }

    // area_manager can only process PRs for their assigned branches
    if (user.role === "area_manager") {
      if (oldPr.branchId !== user.branchId && !user.assignedBranches?.includes(oldPr.branchId)) {
        throw new Error("Unauthorized: not assigned to this branch");
      }
      // area_manager can only set status to Approved, Processed, or Rejected
      if (status && !["Approved", "Processed", "Rejected"].includes(status)) {
        throw new Error("Unauthorized status change for area_manager");
      }
    }

    // admin_pusat and super_admin can process any PR
    if (user.role === "admin_pusat" || user.role === "super_admin") {
      // No additional restrictions
    }

    // Proceed with update...
  });
```

---

## 2. Row-Level Action Buttons

### Target UI

Each PR row in the table shows action buttons based on status and user role:

| Status    | branch_admin  | area_manager+           |
| --------- | ------------- | ----------------------- |
| Draft     | Edit, Submit  | —                       |
| Pending   | — (view only) | **Process**, **Reject** |
| Approved  | —             | **Process**, **Reject** |
| Processed | —             | View SJ link            |
| Rejected  | —             | —                       |
| Fulfilled | —             | —                       |

### Files to Modify

#### 2.1 `src/routes/_layout/purchase-requisitions/index.tsx` — Table Column Actions

Replace the current single "Proses" button with two buttons and conditional logic:

```tsx
{
  key: "id",
  header: "Aksi",
  width: "w-40",
  render: (r) => {
    const canProcess = ["area_manager", "admin_pusat", "super_admin"].includes(user?.role ?? "") &&
      ["Pending", "Approved"].includes(r.status);
    const canReject = ["area_manager", "admin_pusat", "super_admin"].includes(user?.role ?? "") &&
      ["Pending", "Approved"].includes(r.status);
    const canEdit = user?.role === "branch_admin" && r.status === "Draft";

    return (
      <div className="flex items-center justify-end gap-1">
        {canProcess && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleProcessClick(r);
            }}
            className="h-7 px-2 rounded-md bg-primary text-primary-foreground text-[10px] font-medium"
          >
            Proses
          </button>
        )}
        {canReject && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRejectClick(r);
            }}
            className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium"
          >
            Tolak
          </button>
        )}
        {canEdit && (
          <Link
            to="/purchase-requisitions/$prId"
            params={{ prId: r.id }}
            className="inline-flex h-7 px-2 items-center rounded-md border text-[10px]"
          >
            Edit
          </Link>
        )}
        <Link
          to="/purchase-requisitions/$prId"
          params={{ prId: r.id }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  },
}
```

#### 2.2 Add `handleProcessClick` and `handleRejectClick` functions

```tsx
const [processPr, setProcessPr] = useState<PRRow | null>(null);
const [rejectPr, setRejectPr] = useState<PRRow | null>(null);
const [createSJPrompt, setCreateSJPrompt] = useState(false);

const handleProcessClick = (pr: PRRow) => {
  setProcessPr(pr);
  setCreateSJPrompt(true);
};

const handleRejectClick = (pr: PRRow) => {
  setRejectPr(pr);
};

const confirmProcess = (alsoCreateSJ: boolean) => {
  if (!processPr) return;
  void processMutation.mutateAsync({
    data: {
      id: processPr.id,
      status: "Processed",
      alsoCreateSJ,
    },
  });
  setProcessPr(null);
  setCreateSJPrompt(false);
};

const confirmReject = (reason: string) => {
  if (!rejectPr) return;
  void rejectMutation.mutateAsync({
    data: {
      id: rejectPr.id,
      status: "Rejected",
      rejectionReason: reason,
    },
  });
  setRejectPr(null);
};
```

#### 2.3 Add Process + Reject Mutations

```tsx
const processMutation = useMutation({
  mutationFn: processPurchaseRequisition, // New server fn
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
    void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
  },
});

const rejectMutation = useMutation({
  mutationFn: updatePurchaseRequisition,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["purchase-requisitions"] });
  },
});
```

---

## 3. Surat Jalan (Delivery Note) Auto-Creation

### Flow

1. User clicks **"Proses"** on a PR row
2. A confirmation modal appears asking: **"Buat Surat Jalan juga?"** with Yes/No options
3. If **Yes**:
   - Update PR status to `"Processed"`
   - Auto-create a Delivery Note (SJ) linked to the PR
   - Copy all PR items to DN items (quantity = PR quantity, readyQuantity = PR quantity)
   - DN status = `"Picking"`
   - fromBranchId = `"CENTRAL"` (or the branch with `type: "Central"`)
   - toBranchId = PR's branchId
   - Generate DN code: `SJ-{PR.code}` or auto-increment `SJ-YYYYMMDD-###`
4. If **No**:
   - Just update PR status to `"Processed"`

### Files to Modify

#### 3.1 `src/lib/server/scm.ts` — New `processPurchaseRequisition` Server Function

```ts
export const processPurchaseRequisition = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; alsoCreateSJ: boolean; driverName?: string; vehicleNumber?: string }) =>
      data,
  )
  .handler(async ({ data }) => {
    const user = await requireAuth();

    // Role check
    if (!["area_manager", "admin_pusat", "super_admin"].includes(user.role)) {
      throw new Error("Forbidden: insufficient role to process PR");
    }

    const [pr] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, data.id))
      .limit(1);

    if (!pr) throw new Error("PR not found");
    if (!["Pending", "Approved"].includes(pr.status)) {
      throw new Error("PR must be Pending or Approved to process");
    }

    // Area manager branch check
    if (user.role === "area_manager") {
      if (pr.branchId !== user.branchId && !user.assignedBranches?.includes(pr.branchId)) {
        throw new Error("Unauthorized: not assigned to this branch");
      }
    }

    // Get PR items
    const items = await db
      .select()
      .from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.purchaseRequisitionId, data.id));

    // Update PR status to Processed
    await db
      .update(purchaseRequisitions)
      .set({
        status: "Processed",
        approvedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequisitions.id, data.id));

    let dn = null;

    // Auto-create Delivery Note if requested
    if (data.alsoCreateSJ) {
      // Find central branch
      const [centralBranch] = await db
        .select()
        .from(branches)
        .where(eq(branches.type, "Central"))
        .limit(1);

      const fromBranchId = centralBranch?.id ?? pr.branchId;

      // Generate SJ code
      const today = new Date();
      const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      const existingSJCount = await db
        .select({ count: deliveryNotes.code })
        .from(deliveryNotes)
        .where(eq(deliveryNotes.purchaseRequisitionId, data.id));
      const suffix = existingSJCount.length > 0 ? `-${existingSJCount.length + 1}` : "";
      const sjCode = `SJ-${pr.code}${suffix}`;

      [dn] = await db
        .insert(deliveryNotes)
        .values({
          code: sjCode,
          purchaseRequisitionId: data.id,
          fromBranchId,
          toBranchId: pr.branchId,
          status: "Picking",
          driverName: data.driverName ?? "Belum ditentukan",
          vehicleNumber: data.vehicleNumber,
        })
        .returning();

      // Copy PR items to DN items
      if (items.length > 0) {
        await db.insert(deliveryNoteItems).values(
          items.map((item) => ({
            deliveryNoteId: dn.id,
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            readyQuantity: item.quantity, // Assume all ready at creation time
            pickedQuantity: 0,
            receivedQuantity: 0,
            rejectedQuantity: 0,
          })),
        );
      }

      // Create in-transit inventory records
      for (const item of items) {
        await db.insert(inTransitInventory).values({
          deliveryNoteId: dn.id,
          branchId: pr.branchId,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
        });
      }

      await logSystemAction(
        user,
        "Auto-Create Delivery Note",
        `SJ "${sjCode}" dibuat otomatis dari PR "${pr.code}" oleh ${user.name}`,
      );
    }

    await logSystemAction(
      user,
      "Process Purchase Requisition",
      `PR "${pr.code}" diproses oleh ${user.name}${data.alsoCreateSJ ? ` (dengan SJ "${dn?.code}")` : ""}`,
    );

    return { success: true, prId: data.id, dnId: dn?.id };
  });
```

#### 3.2 Update `getDeliveryNotes` to include `purchaseRequisitionId`

Add `purchaseRequisitionId` to the select so the PR page can show "SJ Created" status:

```ts
.select({
  id: deliveryNotes.id,
  code: deliveryNotes.code,
  purchaseRequisitionId: deliveryNotes.purchaseRequisitionId,
  // ...existing fields
})
```

#### 3.3 `src/routes/_layout/purchase-requisitions/index.tsx` — Confirmation Modals

Add two new modals:

**A. Process Confirmation Modal (with SJ prompt)**

```tsx
{
  /* Process Confirmation Modal */
}
<Modal
  open={!!processPr && createSJPrompt}
  onClose={() => {
    setProcessPr(null);
    setCreateSJPrompt(false);
  }}
  title="Proses Purchase Requisition"
>
  {processPr && (
    <div className="space-y-4">
      <p className="text-sm">
        Proses PR <strong>{processPr.code}</strong>?
      </p>
      <p className="text-sm text-muted-foreground">
        Tindakan ini akan mengubah status PR menjadi <strong>Processed</strong>.
      </p>
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-medium">Buat Surat Jalan juga?</p>
        <div className="flex gap-2">
          <button
            onClick={() => confirmProcess(true)}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
          >
            Ya, Buat SJ
          </button>
          <button
            onClick={() => confirmProcess(false)}
            className="h-9 px-4 rounded-md border text-sm"
          >
            Tidak, Hanya Proses
          </button>
        </div>
      </div>
      <button
        onClick={() => {
          setProcessPr(null);
          setCreateSJPrompt(false);
        }}
        className="h-9 px-4 rounded-md border text-sm w-full"
      >
        Batal
      </button>
    </div>
  )}
</Modal>;
```

**B. Reject Confirmation Modal (with reason input)**

```tsx
{
  /* Reject Confirmation Modal */
}
<Modal open={!!rejectPr} onClose={() => setRejectPr(null)} title="Tolak Purchase Requisition">
  {rejectPr && (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        confirmReject(fd.get("reason") as string);
      }}
      className="space-y-4"
    >
      <p className="text-sm">
        Tolak PR <strong>{rejectPr.code}</strong>?
      </p>
      <div className="space-y-2">
        <label className="text-sm font-medium">Alasan Penolakan</label>
        <textarea
          name="reason"
          required
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Contoh: Stok masih mencukupi, tidak perlu pengadaan..."
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setRejectPr(null)}
          className="h-9 px-4 rounded-md border text-sm"
        >
          Batal
        </button>
        <button
          type="submit"
          className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
        >
          Tolak PR
        </button>
      </div>
    </form>
  )}
</Modal>;
```

---

## 4. PR Detail Page Updates

### 4.1 `src/routes/_layout/purchase-requisitions/$prId.tsx`

Show action buttons on detail page too:

```tsx
const canProcess =
  ["area_manager", "admin_pusat", "super_admin"].includes(user?.role ?? "") &&
  ["Pending", "Approved"].includes(pr.status);
const canReject =
  ["area_manager", "admin_pusat", "super_admin"].includes(user?.role ?? "") &&
  ["Pending", "Approved"].includes(pr.status);

// In the header section:
<div className="flex items-center gap-3">
  <Badge variant={statusColors[pr.status] ?? "default"}>{pr.status}</Badge>
  {canProcess && (
    <button
      onClick={() => handleProcessClick(pr)}
      className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm"
    >
      Proses
    </button>
  )}
  {canReject && (
    <button
      onClick={() => handleRejectClick(pr)}
      className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm"
    >
      Tolak
    </button>
  )}
  {canEdit && (
    <button onClick={() => setIsEditing(!isEditing)} className="h-9 px-4 rounded-md border text-sm">
      {isEditing ? "Batal" : "Edit"}
    </button>
  )}
</div>;
```

**Show linked Delivery Note** if one was created from this PR:

```tsx
// After the items table:
const { data: linkedDN } = useQuery({
  queryKey: ["dn-by-pr", prId],
  queryFn: async () => {
    const dns = await getDeliveryNotes({ data: {} });
    return dns.find((dn) => dn.purchaseRequisitionId === prId);
  },
});

{
  linkedDN && (
    <div className="rounded-md border p-4 space-y-2">
      <p className="text-xs text-muted-foreground uppercase">Surat Jalan Terkait</p>
      <Link
        to="/delivery-notes/$dnId"
        params={{ dnId: linkedDN.id }}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <Truck className="h-4 w-4" />
        {linkedDN.code} — {linkedDN.status}
      </Link>
    </div>
  );
}
```

---

## 5. Data Fetching: Include `approvedBy` User Name

### 5.1 Update `getPurchaseRequisitions` in `src/lib/server/scm.ts`

Join with users table to get approver name:

```ts
.select({
  id: purchaseRequisitions.id,
  code: purchaseRequisitions.code,
  branchId: purchaseRequisitions.branchId,
  status: purchaseRequisitions.status,
  requestedBy: purchaseRequisitions.requestedBy,
  approvedBy: purchaseRequisitions.approvedBy,
  approvedByName: users.name,
  rejectionReason: purchaseRequisitions.rejectionReason,
  createdAt: purchaseRequisitions.createdAt,
  updatedAt: purchaseRequisitions.updatedAt,
  branchName: branches.name,
})
.from(purchaseRequisitions)
.leftJoin(branches, eq(purchaseRequisitions.branchId, branches.id))
.leftJoin(users, eq(purchaseRequisitions.approvedBy, users.id))
```

---

## 6. Summary of Changes

### Server Files

| File                    | Changes                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/scm.ts` | Add `processPurchaseRequisition()` fn; enforce role checks in `updatePurchaseRequisition`; add `approvedByName` to `getPurchaseRequisitions`; add `purchaseRequisitionId` to `getDeliveryNotes` |

### Client Files

| File                                                 | Changes                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_layout/purchase-requisitions/index.tsx` | Role-gate create button; add Process/Reject buttons per row; add process/reject modals; add `processMutation`; update column definitions |
| `src/routes/_layout/purchase-requisitions/$prId.tsx` | Add Process/Reject buttons in header; show linked SJ if exists; conditionally show Edit                                                  |

### Database

No schema changes needed. All required fields already exist.

---

## 7. Testing Checklist

- [ ] **branch_admin** can create PR for own branch only
- [ ] **branch_admin** cannot create PR for other branches
- [ ] **branch_admin** cannot see Process/Reject buttons
- [ ] **branch_admin** can edit own Draft PR
- [ ] **area_manager** can see Process/Reject buttons for assigned branches
- [ ] **area_manager** cannot process PR for non-assigned branches
- [ ] **admin_pusat** / **super_admin** can process/reject any PR
- [ ] Clicking **Process** shows "Buat Surat Jalan juga?" prompt
- [ ] **"Ya, Buat SJ"** creates DN with status "Picking", links to PR, copies items
- [ ] **"Tidak, Hanya Proses"** updates PR status without creating DN
- [ ] **Reject** shows reason input modal; stores `rejectionReason`
- [ ] Processed PR shows linked SJ code on detail page
- [ ] `vp check` passes
- [ ] `vp build` passes
