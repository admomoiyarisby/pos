# Plan: Reprint Invoice Button on Riwayat Pemesanan Page

## Goal

Add a "Cetak Ulang" (Reprint Invoice) button to the order detail modal on the `/order-history` page, allowing super admins to request a reprint of any completed order's invoice using the existing approval flow. Also add sidebar navigation to the print-requests approval page.

---

## ✅ Completed Changes

### 1. `src/routes/_layout/order-history.tsx` — Add reprint button, mutation, and status feedback

#### Changes made:

| Change                       | Description                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Imports                      | Added `useMutation`, `requestReprint`, `Printer`, `AlertCircle`, `CheckCircle2`, `Clock`          |
| `OrderRow` interface         | Added `branchId: string` (already returned by `getOrders` but wasn't typed)                       |
| `ReprintStatus` type         | New union type: `"idle" \| "pending" \| "already_pending" \| "error"`                             |
| `reprintStatus` state        | Tracks the status of a reprint request, resets to `"idle"` on modal close                         |
| `reprintMutation`            | `useMutation` calling `requestReprint`, sets status on success/error                              |
| `handleReprint()`            | Calls `reprintMutation.mutate(...)` with `orderId` and `requestType: "reprint"`                   |
| `handleCloseModal()`         | Resets both `selectedOrder` and `reprintStatus` to avoid stale state                              |
| "Cetak Ulang Invoice" button | Renders only when `order.status === "Completed"`; disabled during mutation                        |
| Status feedback banners      | Three conditional banners: blue check (pending), amber clock (already pending), red alert (error) |

#### Key implementation details:

- Used `reprintMutation.mutate()` (fire-and-forget) instead of `mutateAsync()` to avoid floating promise lint warning
- Used `as any` cast on the `result` in `onSuccess` since `requestReprint` returns either `PrintRequest` or `PrintRequest & { alreadyPending: boolean }` — this matches the existing pattern used in `pos.tsx:742`
- Static `isCompleted` derived value keeps rendering logic clean

### 2. `src/components/Sidebar.tsx` — Add Cetak Ulang sidebar link

#### Changes made:

| Change      | Description                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Import      | Added `Printer` from `lucide-react`                                                                            |
| Group roles | Added `"area_manager"` to the "Operasional" group's `roles` array (sidebar visibility pre-filter)              |
| New item    | Added `{ label: "Cetak Ulang", to: "/print-requests", icon: Printer, roles: ["super_admin", "area_manager"] }` |

The existing `SidebarGroup` component's per-item role filtering ensures `area_manager` sees only the Cetak Ulang link (not POS or Riwayat Pemesanan).

---

## UX Flow

```
User opens order detail modal (/order-history)
  → sees "Cetak Ulang Invoice" button (if order.status === "Completed")
  → clicks button
  → mutation fires requestReprint()
  → banner shown in modal:
      ✅ blue: "Permintaan cetak ulang dikirim ke Area Manager"
      🟡 amber: "Permintaan sudah diajukan sebelumnya, menunggu persetujuan"
      ❌ red: "Gagal mengajukan permintaan"
  → Area Manager checks /print-requests sidebar link (new!)
  → approves or rejects
  → cashier gets notification
```

## Edge Cases Handled

- **Already pending**: `requestReprint` checks for existing pending request; `alreadyPending` flag shown to user
- **Non-Completed orders**: Button is hidden entirely (`isCompleted` guard)
- **Network error**: Mutation `onError` shows red error banner
- **Modal closing**: `handleCloseModal` resets `reprintStatus` to `"idle"` so stale state doesn't carry over
- **Role access**: Button guarded by existing `RoleGuard` (`super_admin` only); sidebar link visible to both `super_admin` and `area_manager`

## Files Changed

| File                                   | Lines Added | Change                                                        |
| -------------------------------------- | ----------- | ------------------------------------------------------------- |
| `src/routes/_layout/order-history.tsx` | ~40         | Add reprint button, mutation, status feedback in detail modal |
| `src/components/Sidebar.tsx`           | ~5          | Add `Printer` import, Cetak Ulang link, extend group roles    |
| `src/lib/server/pos.ts`                | 0           | No changes needed — existing `requestReprint` reused          |

## Verification

All checks pass: `vp check` reports 0 errors, 0 warnings, 0 formatting issues across 140 files.

---

## Future Plans

### Short-term (Next Sprint)

1. **Auto-trigger print on approval**
   - Currently, approval just creates a notification. The cashier must manually re-open the POS or find the order again to print.
   - Idea: Add a `printOnApproval` flag to `printRequests`. When a reprint is approved and the order is from the same branch/session, auto-trigger `window.print()` for the cashier.
   - Challenge: The approving Area Manager may be in a different browser than the cashier. WebSocket or SSE push would be needed (e.g., via a TanStack Start subscription or polling the notification endpoint).

2. **Print Now from notification**
   - The approval notification currently just says "disetujui." Add a "Cetak Sekarang" button that navigates back to the order detail with the receipt pre-loaded for printing.
   - Requires storing order item snapshots accessible without needing the POS cart context.

3. **Reprint history per order**
   - Show a timeline of reprint requests (submitted/approved/rejected) directly in the order detail modal.
   - Add a `getReprintHistory` server function that queries `printRequests` by `orderId`.
   - Render a small timeline component below the existing detail fields.

4. **Direct print for super_admin**
   - Currently, even `super_admin` must go through the approval flow to reprint.
   - For the `/order-history` page (super_admin only), consider adding a "Print Direct" button that skips the approval flow entirely and calls a new `printInvoice` server function.
   - Check: Does `super_admin` really need to bypass the approval? If yes, add a confirmation modal "Cetak langsung tanpa approval?"

### Medium-term

5. **Unified print service**
   - Extract `printReceipt()` and `printBill()` from `pos.tsx` into a shared `#/lib/print.ts` utility so the order-history page (and future pages) can use them without duplicating thermal-printer HTML logic.
   - This would allow the "Print Now after approval" flow to work from any page, not just POS.

6. **Receipt preview in modal**
   - Add a small receipt preview (read-only rendered receipt) inside the order detail modal so users can see what will print before requesting a reprint.
   - Reuse the `printReceipt` HTML-rendering logic but display it in an iframe or a styled div.

7. **Batch reprint**
   - Allow selecting multiple orders in the DataTable and reprinting them in bulk.
   - Each creates a separate `printRequests` entry. Approval could be batch-approved on the Area Manager side.

8. **Soft delete / cancel pending request**
   - Let the requester cancel their own pending reprint request before it's approved.

### Long-term

9. **Kitchen display / docket reprint**
   - The "reprint" concept could extend to kitchen dockets (not just customer invoices).
   - Add `requestType: "kitchen"` and separate print templates.

10. **Print job queue with status tracking**
    - Instead of `window.print()` directly, send print jobs to a backend queue.
    - Poll for completion, handle printer-offline errors, retry logic.
    - This would require a printer management subsystem (printer registry per branch, IP/hostname config, etc.).
