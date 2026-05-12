# Language Change: English → Bahasa Indonesia

All sidebar navigation labels, page titles, section headings, and prominent UI titles translated from English to Bahasa Indonesia for consistency with the existing Indonesian UI.

## Sidebar (`src/components/Sidebar.tsx`)

| Before               | After                   |
| -------------------- | ----------------------- |
| Order Entry (POS)    | Entry Pesanan (POS)     |
| Stock Opname         | Opname Stok             |
| Waste                | Pemborosan              |
| Broken Stock         | Barang Rusak            |
| Purchase Requisition | Permintaan Pembelian    |
| Modifier Groups      | Grup Modifier           |
| Users                | Pengguna                |
| Brand                | Merek                   |
| Finance & Recon      | Keuangan & Rekonsiliasi |
| Dashboard Analytics  | Dashboard Analitik      |
| Period Control       | Kontrol Periode         |
| System Logs          | Log Sistem              |
| Yield Tracking       | Tracking Produksi       |

#### Group labels

| Before       | After        |
| ------------ | ------------ |
| Supply Chain | Rantai Pasok |
| Master Data  | Data Master  |

## Page Titles (`usePageTitle` calls)

| File                              | Before                               | After                               |
| --------------------------------- | ------------------------------------ | ----------------------------------- |
| `dashboard.tsx`                   | "Dashboard" — "Analytics & overview" | "Dashboard" — "Analitik & ikhtisar" |
| `pos.tsx`                         | "POS" — "Point of Sale"              | "POS" — "Titik Penjualan"           |
| `finance/index.tsx`               | "Finance & Reconciliation"           | "Keuangan & Rekonsiliasi"           |
| `analytics/index.tsx`             | "Dashboard Analytics"                | "Dashboard Analitik"                |
| `purchase-requisitions/index.tsx` | "Purchase Requisition"               | "Permintaan Pembelian"              |
| `purchase-orders/index.tsx`       | "Purchase Order"                     | "Pemesanan Pembelian"               |
| `stock-opname/index.tsx`          | "Stock Opname"                       | "Opname Stok"                       |
| `modifier-groups/index.tsx`       | "Modifier Groups"                    | "Grup Modifier"                     |
| `admin/system-logs.tsx`           | "System Logs"                        | "Log Sistem"                        |
| `admin/audit-logs.tsx`            | "Audit Logs"                         | "Log Audit"                         |
| `admin/platform-fees.tsx`         | "Platform Fees"                      | "Biaya Platform"                    |
| `period-control/index.tsx`        | "Period Control"                     | "Kontrol Periode"                   |
| `yield-tracking.tsx`              | "Yield Tracking"                     | "Tracking Produksi"                 |
| `waste/index.tsx`                 | "Waste"                              | "Pemborosan"                        |
| `waste/broken-stock.tsx`          | "Broken Stock"                       | "Barang Rusak"                      |
| `admin/brands.tsx`                | "Manajemen Brand"                    | "Manajemen Merek"                   |
| `admin/users.tsx`                 | "Manajemen User"                     | "Manajemen Pengguna"                |

## Section Headings (`<h1>`, `<h2>`, `<h3>`)

| File                           | Before                  | After                      |
| ------------------------------ | ----------------------- | -------------------------- |
| `purchase-orders/$poId.tsx`    | Detail Purchase Order   | Detail Pemesanan Pembelian |
| `modifier-groups/$mgId.tsx`    | Detail Modifier Group   | Detail Grup Modifier       |
| `stock-opname/$soId.tsx`       | Stock Opname            | Opname Stok                |
| `recipes/$recipeId.tsx`        | Modifier Groups         | Grup Modifier              |
| `period-control/$periodId.tsx` | Opening Balance (…item) | Saldo Awal (…item)         |
| `period-control/$periodId.tsx` | Closing Balance (…item) | Saldo Akhir (…item)        |
| `admin/index.tsx`              | Smart Reordering        | Pemesanan Ulang Otomatis   |

## Modal Titles & Buttons

| File                     | Before               | After               |
| ------------------------ | -------------------- | ------------------- |
| `stock-opname/$soId.tsx` | Submit SO            | Kirim Opname        |
| `stock-opname/$soId.tsx` | Approve & Adjust     | Setujui & Sesuaikan |
| `stock-opname/$soId.tsx` | Approve Stock Opname | Setujui Opname Stok |
| `admin/audit-logs.tsx`   | Detail Audit Log     | Detail Log Audit    |
| `admin/brands.tsx`       | Tambah Brand         | Tambah Merek        |
| `admin/brands.tsx`       | Edit Brand           | Edit Merek          |
| `admin/users.tsx`        | Tambah User          | Tambah Pengguna     |
| `admin/users.tsx`        | Edit User            | Edit Pengguna       |

## Verification

All changes pass `vp check` with **0 errors, 0 warnings** across 140 files.
