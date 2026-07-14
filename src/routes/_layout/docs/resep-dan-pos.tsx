import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { ShoppingCart } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/resep-dan-pos")({
  component: ResepDanPosPage,
});

const markdownContent = `
> **Konsep Penting**
>
> Resep hanya muncul di kasir jika **semua bahan** dalam BOM tersedia di stok cabang. Saat transaksi terjadi, stok bahan **otomatis berkurang**.

## Apa itu BOM?

Setiap resep memiliki **Bill of Materials (BOM)** — daftar bahan dan takaran. Contoh:

> **Nasi Goreng Spesial**
> - Beras: 200g
> - Ayam Marinasi: 100g
> - Telur: 2 butir
> - Minyak Goreng: 15ml
> - Kecap Manis: 10ml

## Alur Penjualan

1. Kasir membuka POS, melihat resep yang tersedia (hanya yang bahan lengkap)
2. Pelanggan memesan, kasir memilih resep
3. Pelanggan bisa pilih modifier (add-on atau exclusion)
4. Sistem menghitung total kebutuhan bahan
5. Sistem mengecek stok — jika cukup, item bisa ditambahkan
6. Saat pembayaran: stok otomatis berkurang, Kartu Stok mencatat

## Contoh Kasus

> **Pelanggan pesan Nasi Goreng Spesial + extra telur, tanpa bawang**
>
> **Stok berkurang:**
> - Beras: -200g
> - Ayam Marinasi: -100g
> - Telur: -3 butir (2 BOM + 1 extra)
> - Minyak Goreng: -15ml
> - Kecap Manis: -10ml
> - Bawang Merah: 0 (excluded)

## HPP (Harga Pokok Penjualan)

HPP resep = total biaya semua bahan dalam BOM. Dihitung otomatis oleh sistem. Jika harga bahan berubah, HPP resep dihitung ulang otomatis.

## Pertanyaan Umum

**Kenapa resep saya tidak muncul di POS?**

Cek stok bahan di cabang tersebut. Jika ada bahan yang stoknya 0, resep tidak akan muncul. Tambah stok melalui Pengadaan atau Mutasi Stok.

**Kapan stok berkurang — saat pesanan dibuat atau saat bayar?**

Saat pembayaran dikonfirmasi. Sebelum itu, stok belum berubah.

**Bagaimana kalau pesanan dibatalkan?**

Sistem mengembalikan stok (restorasi) untuk setiap bahan yang sudah dikurangi.

**Kenapa HPP resep berubah padahal saya tidak edit resep?**

Karena HPP dihitung dari harga bahan terkini. Jika harga bahan berubah (misalnya setelah supplier delivery), HPP resep dihitung ulang otomatis.
`;

function ResepDanPosPage() {
  usePageTitle("Resep dan POS", "Cara resep muncul di kasir dan stok otomatis berkurang");

  return (
    <DocLayout
      title="Resep dan POS"
      description="Cara resep muncul di kasir dan stok otomatis berkurang"
      step={5}
      totalSteps={5}
      icon={ShoppingCart}
    >
      {markdownContent}
    </DocLayout>
  );
}
