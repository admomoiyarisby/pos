import { createFileRoute } from "@tanstack/react-router";
import { usePageTitle } from "#/hooks/usePageTitle";
import { DocLayout } from "#/components/docs/DocLayout";
import { ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_layout/docs/stok-opname")({
  component: StokOpnamePage,
});

const markdownContent = `
> **Kapan Digunakan?**
>
> Secara berkala (biasanya setiap bulan) untuk memverifikasi bahwa stok fisik sesuai dengan catatan sistem. Ini adalah proses **audit stok**.

## Siapa yang Melakukan?

- **Area Manager / Admin Pusat**: Memicu (trigger) stock opname
- **Branch Admin / Central Kitchen**: Menghitung stok fisik
- **Area Manager / Super Admin**: Menyetujui hasil

## Alur Kerja

1. **Pemicuan**: Supervisor trigger SO untuk suatu cabang
2. **Penghitungan**: Counter menghitung stok fisik (mode blind — tidak bisa lihat stok sistem)
3. **Submit**: Counter submit hasil hitungan
4. **Review**: Supervisor review variance (selisih)
5. **Approval**: Supervisor setujui — hasil hitungan jadi catatan resmi, stok **belum** berubah

## Memahami Variance (Selisih)

| Variance | Arti | Contoh |
|----------|------|--------|
| Positif (+) | Stok fisik lebih banyak | Sistem 50, Fisik 52 |
| Negatif (-) | Stok fisik lebih sedikit | Sistem 50, Fisik 48 |

## Contoh Kasus

> **Cabang Surabaya stock opname Juli**
>
> **Ayam Mentah:** Sistem 50, Fisik 48 → Variance -2 (susut alami)
>
> **Minyak Goreng:** Sistem 30, Fisik 32 → Variance +2 (perlu investigasi)
>
> **Hasil:** Saat **realize** (opname tanggal 25), selisihnya diterapkan ke stok berjalan — penjualan setelah tanggal opname tetap berlaku

## Pertanyaan Umum

**Kenapa mode "blind" (tidak bisa lihat stok sistem)?**

Untuk mencegah counter "mengikuti" angka sistem. Penghitungan harus berdasarkan apa yang benar-benar ada di fisik.

**Berapa sering harus stock opname?**

Idealnya setiap bulan, tapi tergantung kebutuhan bisnis.

**Opname di luar tanggal 25 apakah mengubah stok?**

Tidak. Hanya opname yang **tanggalnya 25** yang mengubah stok saat di-realize. Opname tanggal lain hanya catatan/audit.

**Apa itu "realize" pada tanggal 25?**

Realisasi adalah proses final yang menerapkan penyesuaian SO ke stok. Hanya bisa untuk opname yang tanggalnya 25, oleh Super Admin/Admin Pusat.

**Kalau opname tanggal 25 baru di-realize tanggal 28 atau 29, apakah penjualan tanggal 28–29 tertimpa?**

Tidak. Realize menerapkan **selisih** hasil hitungan (fisik − stok sistem saat opname) ke stok saat ini, bukan menyetel stok kembali ke angka fisik. Penjualan/pemakaian yang tercatat setelah tanggal opname tetap berlaku dan tetap muncul di Stok Keluar serta Kartu Stok. Contoh: sistem 10, fisik 7 (selisih -3), lalu 5 terjual → stok 5; realize menghasilkan 5 − 3 = 2.
`;

function StokOpnamePage() {
  usePageTitle("Stock Opname", "Cara melakukan penghitungan stok fisik");

  return (
    <DocLayout title="Stock Opname" description="Penghitungan stok fisik" icon={ClipboardList}>
      {markdownContent}
    </DocLayout>
  );
}
