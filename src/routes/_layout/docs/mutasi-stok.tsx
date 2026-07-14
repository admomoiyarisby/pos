import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { ArrowRightLeft } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/mutasi-stok")({
  component: MutasiStokPage,
});

const markdownContent = `
> **Kapan Digunakan?**
>
> Ketika satu cabang kehabisan stok dan perlu meminta dari cabang lain. Berbeda dengan Pengadaan (dari Gudang Pusat), Mutasi Stok terjadi **antar cabang**.

## Siapa yang Melakukan?

- **Cabang Penerima**: Membuat permintaan
- **Area Manager**: Menyetujui mutasi
- **Cabang Pengirim**: Menyiapkan dan mengirim barang

## Halaman Terkait

\`/stock-transfers\` — Halaman utama mutasi stok

## Alur Kerja

1. **Cabang Penerima** buat permintaan mutasi
2. **Area Manager** menyetujui (atau menolak)
3. **Cabang Pengirim** siapkan barang, buat Surat Jalan, kirim
4. **Cabang Penerima** terima barang dan konfirmasi
5. Sistem buat invoice: Cabang Penerima bayar ke Cabang Pengirim

## Perbedaan dengan Pengadaan

| Aspek | Pengadaan | Mutasi Stok |
|-------|-----------|-------------|
| Dari | Gudang Pusat | Cabang lain |
| Ke | Cabang | Cabang lain |
| Yang menyetujui | Admin Pusat | Area Manager |
| Pembayaran | Cabang → Gudang Pusat | Penerima → Pengirim |

## Contoh Kasus

> **Cabang Surabaya minta 20 botol saus sambal dari Cabang Malang**
>
> **Langkah:** Surabaya buat mutasi → Area Manager setujui → Malang kirim → Surabaya terima
>
> **Hasil:** Stok Malang -20, Stok Surabaya +20, Surabaya bayar ke Malang

## Pertanyaan Umum

**Kenapa harus disetujui Area Manager?**

Karena mutasi mempengaruhi stok di dua cabang. Area Manager memastikan kedua cabang benar-benar butuh dan mampu.

**Bisa kirim ke beberapa cabang sekaligus?**

Tidak. Satu mutasi = satu cabang pengirim → satu cabang penerima. Buat beberapa mutasi jika perlu.
`;

function MutasiStokPage() {
  usePageTitle("Mutasi Stok (Antar Cabang)", "Cara transfer stok antar cabang");

  return (
    <DocLayout
      title="Mutasi Stok (Antar Cabang)"
      description="Cara transfer stok antar cabang"
      step={4}
      totalSteps={5}
      icon={ArrowRightLeft}
    >
      {markdownContent}
    </DocLayout>
  );
}
