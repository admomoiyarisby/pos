import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/produksi-internal")({
  component: ProduksiInternalPage,
});

const markdownContent = `
> **Kapan Digunakan?**
>
> Ketika Gudang Pusat (Central Kitchen) mengolah bahan mentah (RM) menjadi bahan setengah jadi (SFG).
>
> Contoh: Ayam mentah → Ayam marinasi, Tepung + telur → Adonan

## Siapa yang Melakukan?

**Super Admin** atau **Central Kitchen**

## Halaman Terkait

\`/yield-tracking\` — Halaman utama untuk mencatat produksi internal

## Alur Kerja

1. Buka halaman **Tracking Produksi** (\`/yield-tracking\`)
2. Klik tombol **"Input Produksi"**
3. Isi form:
   - **Tanggal Produksi**: Tanggal produksi dilakukan
   - **Bahan Mentah**: Pilih bahan yang diolah + jumlah
   - **Hasil Matang**: Pilih bahan hasil + jumlah
   - **Catatan**: Keterangan opsional
4. Klik **"Catat Produksi"**

## Apa yang Terjadi di Sistem?

1. **Mengurangi stok** bahan mentah di Gudang Pusat
2. **Menambah stok** bahan hasil (SFG/FG) di Gudang Pusat
3. **Mencatat di Kartu Stok**: bahan mentah OUT, bahan hasil IN
4. **Menghitung HPP** bahan hasil = Total Biaya ÷ Jumlah Hasil
5. **Menghitung yield dan shrinkage**

## Contoh Kasus

> **Central Kitchen mengolah 5kg ayam mentah menjadi ayam marinasi**
>
> **Input:** Ayam Mentah 5000g
>
> **Output:** Ayam Marinasi 4500g
>
> **Hasil:** Stok ayam mentah -5000, stok ayam marinasi +4500, Yield 90%, Shrinkage 500g

## Pertanyaan Umum

**Bisa produksi di cabang (bukan Gudang Pusat)?**

Tidak. Produksi internal hanya bisa dilakukan di Gudang Pusat.

**Kenapa HPP berubah setelah produksi?**

Karena HPP bahan hasil = total biaya bahan mentah ÷ jumlah hasil. Jika yield rendah, HPP per unit lebih tinggi.
`;

function ProduksiInternalPage() {
  usePageTitle(
    "Produksi Internal (Yield)",
    "Cara mengubah bahan mentah menjadi bahan setengah jadi",
  );

  return (
    <DocLayout
      title="Produksi Internal (Yield Tracking)"
      description="Cara mengubah bahan mentah menjadi bahan setengah jadi"
      step={2}
      totalSteps={5}
      icon={RefreshCw}
    >
      {markdownContent}
    </DocLayout>
  );
}
