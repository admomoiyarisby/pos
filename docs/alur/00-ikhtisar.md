# Alur Stok: Dari Bahan Mentah Sampai Siap Jual

Dokumen ini menjelaskan alur lengkap bagaimana bahan mentah dari supplier akhirnya menjadi produk siap jual di kasir (POS).

## Ringkasan Alur

```
┌─────────────────────────────────────────────────────────────────┐
│  1. BAHAN MENTAH (RM)                                           │
│     Supplier → Barang Masuk → Gudang Pusat                      │
├─────────────────────────────────────────────────────────────────┤
│  2. PRODUKSI INTERNAL                                           │
│     Bahan Mentah → Yield Tracking → Bahan Setengah Jadi (SFG)   │
├─────────────────────────────────────────────────────────────────┤
│  3. DISTRIBUSI KE CABANG                                        │
│     Gudang Pusat → Pengadaan → Cabang                           │
│     Cabang A → Mutasi Stok → Cabang B                           │
├─────────────────────────────────────────────────────────────────┤
│  4. RESEP & POS                                                 │
│     Bahan di cabang → Resep tersedia → Transaksi → Stok kurang  │
└─────────────────────────────────────────────────────────────────┘
```

## Halaman Dokumen

| Halaman                                              | Isi                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| [01-barang-masuk.md](./01-barang-masuk.md)           | Cara mencatat penerimaan barang dari supplier ke Gudang Pusat  |
| [02-produksi-internal.md](./02-produksi-internal.md) | Cara mengubah bahan mentah menjadi bahan setengah jadi (yield) |
| [03-pengadaan.md](./03-pengadaan.md)                 | Cara mendistribusikan stok dari Gudang Pusat ke cabang         |
| [04-mutasi-stok.md](./04-mutasi-stok.md)             | Cara transfer stok antar cabang                                |
| [05-resep-dan-pos.md](./05-resep-dan-pos.md)         | Cara resep muncul di kasir dan stok otomatis berkurang         |
| [06-stok-opname.md](./06-stok-opname.md)             | Cara melakukan penghitungan stok fisik (stock opname)          |
| [07-kartu-stok.md](./07-kartu-stok.md)               | Cara membaca riwayat pergerakan stok                           |

## Siapa yang Melakukan Apa?

| Role                | Tugas Utama                                                 |
| ------------------- | ----------------------------------------------------------- |
| **Super Admin**     | Semua akses, termasuk pengaturan master data                |
| **Admin Pusat**     | Mencatat barang masuk, yield, dan mengelola pengadaan       |
| **Central Kitchen** | Melakukan produksi internal (yield tracking)                |
| **Branch Admin**    | Menerima pengadaan, melakukan mutasi, mengelola stok cabang |
| **Area Manager**    | Menyetujui mutasi stok antar cabang                         |

## Istilah Penting

- **RM (Raw Material)**: Bahan mentah, contoh: ayam, tepung, sayuran
- **SFG (Semi-Finished Good)**: Bahan setengah jadi, contoh: ayam marinasi, saus yang sudah dibuat
- **FG (Finished Good)**: Produk jadi siap jual, contoh: nasi goreng, ayam goreng
- **BOM (Bill of Materials)**: Daftar bahan dan takaran untuk membuat satu resep
- **HPP (Harga Pokok Penjualan)**: Biaya total bahan untuk membuat satu porsi resep
- **Kartu Stok**: Catatan riwayat semua pergerakan stok (masuk dan keluar)
- **Yield**: Persentase hasil dari proses produksi (berapa banyak yang jadi vs yang susut)
- **Shrinkage**: Susut/loss dalam proses produksi
