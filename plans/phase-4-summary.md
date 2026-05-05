# Phase 4 Implementation Summary — Supply Chain (SCM)

## What Was Built

### Server Functions (`src/lib/server/scm.ts`)

| Module                           | Functions                                                                                                     | Purpose                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purchase Requisitions**        | `getPurchaseRequisitions`, `getPurchaseRequisition`, `createPurchaseRequisition`, `updatePurchaseRequisition` | Branch submits request, edits while pending, Admin Pusat clicks "Proses" to lock edits                                                                   |
| **Purchase Orders**              | `getPurchaseOrders`, `createPurchaseOrder`                                                                    | Convert PR to PO with supplier/branch routing                                                                                                            |
| **Delivery Notes (Surat Jalan)** | `getDeliveryNotes`, `getDeliveryNote`, `createDeliveryNote`, `shipDeliveryNote`, `receiveDeliveryNote`        | Full SJ lifecycle: create with 3-pilar input → ship (deducts source inventory, creates in-transit) → receive (adds to destination, handles reject/retur) |
| **SCM Invoices**                 | `getSCMInvoices`, `getSCMInvoice`, `generateSCMInvoice`, `paySCMInvoice`                                      | Auto-generated from received SJ based on actual received qty × current HPP. Mark as Paid                                                                 |
| **Stock Transfers (Mutasi)**     | `getStockTransfers`, `createStockTransfer`, `approveStockTransfer`                                            | Branch requests transfer, Area Manager/Super Admin approves → executes inventory movement + ledger entries                                               |

### Key SCM Logic Implemented

1. **PR → Process Lock**: Once Admin Pusat clicks "Proses", branch can no longer edit the PR
2. **SJ 3-Pilar Input**: Diorder | Ready | Dikirim per item
3. **In-Transit Tracking**: On ship, stock deducted from source + in-transit record created
4. **Branch Receiving**: Input actual received qty + reject qty + discrepancy note
5. **Invoice from Actual**: Invoice total = received qty × current HPP (not ordered qty)
6. **Mutasi Approval**: Pending Approval → Approved → Completed with paired ledger IN/OUT

### Route Pages

#### `/purchase-requisitions` — Purchase Requisition List

- DataTable with all PRs
- Status badge (Draft/Pending/Processed/etc.)
- **"Proses" button** for Admin Pusat/Super Admin on Pending PRs
- Link to detail page
- **Create PR modal**: Code, branch selector (locked for Branch Admin), multi-item picker with qty

#### `/purchase-requisitions/$prId` — PR Detail

- Shows all items: Kode, Nama Bahan, Qty Order, Satuan
- Status badge
- Edit button (only if not Processed and role allows)

#### `/purchase-orders` — Purchase Order List

- DataTable with POs
- Columns: Kode PO, Dari, Ke, Status badge, Detail link
- Super Admin / Admin Pusat only

#### `/delivery-notes` — Surat Jalan List

- DataTable with all SJ
- Columns: Kode SJ, Dari, Ke, Driver, Status badge
- **"Kirim" button** on Picking status → moves to In Transit
- **Create SJ modal**: Code, from/to branches, driver, vehicle number, multi-item with **Diorder | Ready** qty

#### `/delivery-notes/$dnId` — SJ Detail / Penerimaan

- Info cards: Dari, Ke, Driver
- Item table with dynamic columns based on status:
  - Picking: Bahan, Diorder, Ready
  - In Transit/Received: + Dikirim, **Diterima input**, **Reject input**, **Keterangan input**
- **"Konfirmasi Penerimaan"** button for Branch Admin when In Transit
- On confirm: updates inventory, creates ledger, removes in-transit

#### `/scm-invoices` — Invoice SCM List

- DataTable with invoices
- Columns: Kode Invoice, Total, Status (Unpaid/Paid/Cancelled), Dibuat
- **"Bayar"** button on Unpaid invoices
- **Generate Invoice modal**: Select from Received SJ list, auto-generates invoice

#### `/scm-invoices/$invId` — Invoice Detail

- Info cards: Total, Dari, Ke
- Item table: Bahan, Qty, Harga Satuan, Total
- Status badge

#### `/stock-transfers` — Mutasi Stok List

- DataTable with transfers
- Columns: Kode, Dari, Ke, Bahan, Qty, Status badge
- **"Approve"** button on Pending Approval (Super Admin / Area Manager)
- **Create modal**: Code, from/to branches, ingredient, qty

## Auth & RBAC

| Route                    | Allowed Roles  |
| ------------------------ | -------------- |
| `/purchase-requisitions` | SA, AP, AM, BA |
| `/purchase-orders`       | SA, AP         |
| `/delivery-notes`        | SA, AP, AM, BA |
| `/scm-invoices`          | SA, AP, AM, BA |
| `/stock-transfers`       | SA, AP, AM, BA |

Server functions enforce stricter role checks.

## Files Created / Modified

| File                                                 | Lines | Purpose                          |
| ---------------------------------------------------- | ----- | -------------------------------- |
| `src/lib/server/scm.ts`                              | ~680  | All SCM server functions         |
| `src/routes/_layout/purchase-requisitions/index.tsx` | ~200  | PR list + create modal           |
| `src/routes/_layout/purchase-requisitions/$prId.tsx` | ~100  | PR detail                        |
| `src/routes/_layout/purchase-orders/index.tsx`       | ~80   | PO list                          |
| `src/routes/_layout/purchase-orders/$poId.tsx`       | ~30   | PO detail placeholder            |
| `src/routes/_layout/delivery-notes/index.tsx`        | ~220  | SJ list + create + ship          |
| `src/routes/_layout/delivery-notes/$dnId.tsx`        | ~200  | SJ detail + receive form         |
| `src/routes/_layout/scm-invoices/index.tsx`          | ~130  | Invoice list + generate + pay    |
| `src/routes/_layout/scm-invoices/$invId.tsx`         | ~100  | Invoice detail                   |
| `src/routes/_layout/stock-transfers/index.tsx`       | ~170  | Transfer list + create + approve |
| `src/routes/_layout/stock-transfers/$trId.tsx`       | ~30   | Transfer detail placeholder      |

## How to Test Phase 4

1. **Login as Branch Admin** → create PR at `/purchase-requisitions`
2. **Login as Admin Pusat** → click "Proses" on the PR
3. **Create SJ** at `/delivery-notes` referencing the PR
4. **Click "Kirim"** on the SJ → status becomes In Transit
5. **Login as Branch Admin** of destination branch → open SJ detail → enter received qty + any rejects → click "Konfirmasi Penerimaan"
6. **Login as Admin Pusat** → generate invoice from received SJ at `/scm-invoices`
7. **Click "Bayar"** on the invoice
8. **Test Mutasi**: Branch Admin creates transfer → Area Manager approves → inventory moves

## Ready for Phase 5

Phase 4 provides complete supply chain:

- ✅ PR → Process lock
- ✅ PO creation
- ✅ Surat Jalan with 3-pilar input
- ✅ In-transit tracking
- ✅ Branch receiving with reject/retur
- ✅ Invoice auto-generation from actual received qty
- ✅ Mutasi stok with approval workflow

Phase 5 (Yield Tracking & Production) can now begin.
