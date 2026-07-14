import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/pengadaan")({
  component: PengadaanPage,
});

const markdownContent = `
> **Kapan Digunakan?**
>
> Ketika cabang kehabisan stok dan perlu dikirim dari Gudang Pusat. Ini adalah **cara utama** untuk mendistribusikan bahan dari pusat ke cabang.

## Siapa yang Melakukan?

- **Branch Admin (BA)**: Membuat permintaan dan menerima barang
- **Admin Pusat (CA)**: Meninjau, mengirim barang, membuat invoice

## Halaman Terkait

\`/scm-procurements\` — Halaman utama pengadaan

## Alur Kerja

1. **Branch Admin** membuat permintaan (PR) di \`/scm-procurements\`
2. **Admin Pusat** meninjau dan menyetujui permintaan
3. **Admin Pusat** menyiapkan barang, membuat Surat Jalan, mengirim
4. **Branch Admin** menerima barang dan mengisi form penerimaan
5. Sistem membuat invoice otomatis berdasarkan jumlah yang diterima

## Status Pengadaan

| Status | Arti | Siapa Bertindak |
|--------|------|-----------------|
| Draft | Permintaan baru dibuat | Branch Admin |
| Pending | Menunggu review | Admin Pusat |
| In Transit | Barang sedang dikirim | — |
| Delivered | Barang sampai | Branch Admin |
| Finished | Selesai | — |

## Contoh Kasus

> **Cabang Mulyorejo minta 50 unit ayam marinasi dari Gudang Pusat**
>
> **Langkah:** Branch Admin buat PR → Admin Pusat setujui → Kirim barang → Branch Admin terima
>
> **Hasil:** Stok Gudang Pusat -50, Stok Cabang Mulyorejo +50

## Pertanyaan Umum

**Bisa minta barang dari cabang lain (bukan Gudang Pusat)?**

Itu namanya **Mutasi Stok**, bukan Pengadaan. Lihat panduan Mutasi Stok.

**Kenapa harga di invoice bisa berbeda dari harga terakhir?**

Harga diinvoice adalah harga saat permintaan dibuat, bukan harga terkini.
`;

function PengadaanPage() {
  usePageTitle(
    "Pengadaan (Central → Cabang)",
    "Cara mendistribusikan stok dari Gudang Pusat ke cabang",
  );

  return (
    <DocLayout
      title="Pengadaan (Central → Cabang)"
      description="Cara mendistribusikan stok dari Gudang Pusat ke cabang"
      step={3}
      totalSteps={5}
      icon={FileText}
    >
      {markdownContent}
    </DocLayout>
  );
}
