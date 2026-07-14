import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/barang-masuk")({
  component: BarangMasukPage,
});

const markdownContent = `
> **Kapan Digunakan?**
>
> Ketika Gudang Pusat menerima kiriman bahan mentah dari supplier. Ini adalah **cara utama** untuk menambah stok bahan mentah di Gudang Pusat.

## Siapa yang Melakukan?

- **Super Admin** atau **Admin Pusat** yang mencatat penerimaan barang
- Hanya role ini yang bisa membuat, mengedit, atau menghapus catatan barang masuk

## Halaman Terkait

\`/supplier-deliveries\` — Halaman utama untuk mencatat dan melihat barang masuk

## Alur Kerja

### 1. Mencatat Barang Masuk Baru

1. Buka halaman **Barang Masuk** (\`/supplier-deliveries\`)
2. Klik tombol **"Catat Barang Masuk"**
3. Isi form:
   - **Nama Supplier**: Ketik nama supplier (bisa pilih dari daftar yang sudah ada)
   - **Bahan Baku**: Pilih bahan yang diterima dari dropdown
   - **Jumlah**: Masukkan jumlah yang diterima
   - **Total Harga**: Masukkan total harga pembelian (dalam Rupiah)
4. Klik **"Simpan"**

### 2. Apa yang Terjadi di Sistem?

Setelah Anda menyimpan, sistem otomatis:

1. **Menambah stok** bahan tersebut di Gudang Pusat
2. **Mencatat di Kartu Stok** sebagai mutasi "IN" (masuk)
3. **Menghitung ulang HPP** semua resep yang menggunakan bahan tersebut
4. **Mencatat audit log** untuk jejak pemeriksaan

### 3. Mencetak Invoice

Setiap catatan barang masuk bisa dicetak sebagai invoice penerimaan barang:

1. Klik ikon **printer** di kolom Aksi
2. Invoice akan terbuka di tab baru
3. Cetak menggunakan browser (Ctrl+P / Cmd+P)

## Contoh Kasus

> **Supplier "PT Ayam Segar" mengirim 50kg ayam mentah seharga Rp 750.000**
>
> **Langkah:** Buka /supplier-deliveries → Klik "Catat Barang Masuk" → Isi form → Simpan
>
> **Hasil:** Stok ayam mentah bertambah 50, Kartu Stok mencatat IN, HPP resep dihitung ulang

## Pertanyaan Umum

**Bisa catat barang masuk untuk cabang (bukan Gudang Pusat)?**

Tidak. Barang masuk dari supplier selalu masuk ke Gudang Pusat. Untuk mengirim ke cabang, gunakan fitur **Pengadaan**.

**Bagaimana kalau supplier mengirim beberapa bahan sekaligus?**

Buat satu catatan per bahan. Misalnya, jika supplier mengirim ayam dan tepung, buat 2 catatan terpisah.
`;

function BarangMasukPage() {
  usePageTitle("Barang Masuk dari Supplier", "Cara mencatat penerimaan barang dari supplier");

  return (
    <DocLayout
      title="Barang Masuk dari Supplier"
      description="Cara mencatat penerimaan barang dari supplier"
      step={1}
      totalSteps={5}
      icon={Truck}
    >
      {markdownContent}
    </DocLayout>
  );
}
