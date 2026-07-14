import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { ScrollText } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/kartu-stok")({
  component: KartuStokPage,
});

const markdownContent = `
> **Apa itu Kartu Stok?**
>
> Kartu Stok adalah **catatan riwayat** semua pergerakan stok di suatu cabang. Setiap kali stok bertambah atau berkurang, sistem mencatatnya.

## Cara Membaca

| Kolom | Penjelasan |
|-------|------------|
| **Waktu** | Kapan pergerakan terjadi |
| **Bahan/Resep** | Nama bahan atau resep |
| **Tipe** | IN (masuk) atau OUT (keluar) |
| **Qty** | Jumlah masuk atau keluar |
| **Saldo** | Stok setelah pergerakan |
| **Referensi** | Kode transaksi untuk pelacakan |
| **Keterangan** | Penjelasan tambahan |

## Sumber Pergerakan Stok

| Sumber | Tipe | Contoh Referensi |
|--------|------|------------------|
| Supplier Delivery | IN | SD-abc123 |
| Yield/Produksi | IN/OUT | PROD-001 |
| Pengadaan | OUT | PR-xyz789 |
| Mutasi Stok | IN/OUT | TR-def456 |
| POS (Penjualan) | OUT | POS-12345 |
| Stock Opname | IN/OUT | SO-ghi789 |

## Troubleshooting

**Stok di POS tidak sesuai harapan**

1. Buka Kartu Stok, cari bahan bermasalah
2. Periksa semua mutasi OUT — ada penjualan tidak wajar?
3. Periksa semua mutasi IN — supplier delivery sudah tercatat?
4. Jika tetap tidak sesuai, lakukan stock opname

**Stok negatif**

Bisa terjadi karena timing issue. Lakukan stock opname untuk memperbaiki.

**Kenapa ada beberapa baris dengan referensi sama?**

Karena satu transaksi bisa mempengaruhi beberapa bahan. Contoh: satu penjualan Nasi Goreng mencatat beberapa mutasi OUT.
`;

function KartuStokPage() {
  usePageTitle("Kartu Stok", "Cara membaca riwayat pergerakan stok");

  return (
    <DocLayout title="Kartu Stok" description="Riwayat pergerakan stok" icon={ScrollText}>
      {markdownContent}
    </DocLayout>
  );
}
