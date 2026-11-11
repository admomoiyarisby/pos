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
   Selama masih **Draft**, permintaan masih bisa diubah: jumlah bahan, tambah/hapus bahan, serta **Keterangan** dan **Catatan** (tombol **Simpan Keterangan**). Semua perubahan masuk Riwayat.
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

## Rekomendasi Stok (Safety Stock)

Saat memilih bahan di form pengadaan, sistem menampilkan acuan stok:

- **Rata-rata pemakaian** — total stok keluar 3 hari lengkap terakhir (hari ini tidak dihitung) dibagi 3
- **Acuan 5 hari** — rata-rata pemakaian × 5 hari (lead time)
- **Status** — merah: stok kurang dari 5 hari; kuning: 5–7 hari; hijau: lebih dari 7 hari
- **Rekomendasi** — kekurangan stok terhadap acuan 5 hari. Tombol **Isi rekomendasi** mengisi jumlahnya, dan angkanya tetap bisa disesuaikan. Angka rekomendasi ditampilkan satu desimal (mis. \`+10,7 pcs\`), bukan tiga.

## Surat Jalan Qty Kosong (saat review)

Di tahap **Sedang Direview**, Admin Pusat bisa menekan **Cetak SJ (Qty Kosong)**: Surat Jalan yang sama, tetapi kolom **Qty Kirim** dan **Keterangan** dibiarkan kosong agar tim yang menyiapkan barang menulis jumlah kirimnya dengan tangan. Kolom **Qty Order** tetap tercetak sebagai acuan, dan **Satuan** tercetak di kedua sisi (setelah Qty Order dan setelah Qty Kirim), sama seperti form kertas tim gudang. Baris yang sudah ditolak tidak ikut tercetak. Setelah qty diisi di sistem dan pengadaan dikirim, cetak **Surat Jalan** biasa: kolom Qty Order dan Qty Kirim sama-sama terisi.

## Pertanyaan Umum

**Bisa minta barang dari cabang lain (bukan Gudang Pusat)?**

Itu namanya **Mutasi Stok**, bukan Pengadaan. Lihat panduan Mutasi Stok.

**Kenapa harga di invoice bisa berbeda dari harga terakhir?**

Harga diinvoice adalah harga saat permintaan dibuat, bukan harga terkini.

**Kenapa rekomendasi stok untuk suatu bahan kosong ("Belum ada data")?**

Belum ada stok keluar untuk bahan itu dalam 3 hari lengkap terakhir, jadi sistem tidak punya dasar untuk menghitung acuan. Rekomendasi muncul setelah ada pemakaian yang tercatat.
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
