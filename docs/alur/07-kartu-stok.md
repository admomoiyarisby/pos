# 07 — Kartu Stok (Riwayat Pergerakan Stok)

## Apa itu Kartu Stok?

Kartu Stok adalah **catatan riwayat** semua pergerakan stok di suatu cabang. Setiap kali stok bertambah atau berkurang, sistem mencatatnya di Kartu Stok.

## Halaman Terkait

- `/inventory/ledger` — Halaman utama untuk melihat Kartu Stok

## Cara Membaca Kartu Stok

### Kolom-kolom

| Kolom           | Penjelasan                          |
| --------------- | ----------------------------------- |
| **Waktu**       | Kapan pergerakan terjadi            |
| **Bahan/Resep** | Nama bahan atau resep yang bergerak |
| **Tipe**        | `IN` (masuk) atau `OUT` (keluar)    |
| **Qty**         | Jumlah yang masuk atau keluar       |
| **Saldo**       | Stok setelah pergerakan             |
| **Referensi**   | Kode transaksi untuk pelacakan      |
| **Keterangan**  | Penjelasan tambahan                 |

### Membaca Urutan

Kartu Stok ditampilkan dari **terbaru ke terlama**. Untuk membaca kronologi, baca dari bawah ke atas.

### Contoh Kartu Stok

```
Waktu          Bahan           Tipe   Qty    Saldo   Referensi      Keterangan
─────────────────────────────────────────────────────────────────────────────────
14 Jul, 17:57  Ayam Marinasi    IN     50     50     PROD-001       Yield: Ayam Mentah → produksi
14 Jul, 17:57  Ayam Mentah      OUT    5000   0      PROD-001       Yield: produksi → Ayam Marinasi
14 Jul, 10:30  Ayam Mentah      IN     5000   5000   SD-abc123      Supplier Delivery: PT Ayam Segar
13 Jul, 15:00  Beras            OUT    200    800    POS-xyz789     Nasi Goreng Spesial (Beras)
13 Jul, 15:00  Ayam Marinasi    OUT    100    0      POS-xyz789     Nasi Goreng Spesial (Ayam Marinasi)
```

**Membaca (dari bawah ke atas)**:

1. 13 Jul 15:00: Ada penjualan Nasi Goreng Spesial, stok berkurang
2. 14 Jul 10:30: Terima kiriman ayam mentah dari supplier
3. 14 Jul 17:57: Produksi ayam mentah menjadi ayam marinasi

## Sumber Pergerakan Stok

| Sumber                | Tipe   | Contoh Keterangan                          |
| --------------------- | ------ | ------------------------------------------ |
| **Supplier Delivery** | IN     | `Supplier Delivery: PT Ayam Segar`         |
| **Yield/Produksi**    | IN/OUT | `Yield: Ayam Mentah → produksi`            |
| **Pengadaan**         | OUT    | `Procurement: Transfer ke Cabang Surabaya` |
| **Mutasi Stok**       | IN/OUT | `Mutasi dari Cabang Malang`                |
| **POS (Penjualan)**   | OUT    | `POS-12345: Nasi Goreng Spesial (Beras)`   |
| **Stock Opname**      | IN/OUT | `SO Adjustment: Disesuaikan dari 50 ke 48` |
| **Void/Pembatalan**   | IN     | `Void POS-12345: Restorasi stok`           |

## Filter dan Pencarian

### Filter berdasarkan Cabang

- **Super Admin**, **Admin Pusat**, **Area Manager**: Bisa filter berdasarkan cabang
- **Branch Admin**: Hanya bisa melihat stok di cabang sendiri
- **Central Kitchen**: Hanya bisa melihat stok di Gudang Pusat

### Filter berdasarkan Bahan/Resep

Klik pada nama bahan atau resep untuk filter hanya pergerakan bahan/resep tersebut.

## Membaca Kartu Stok untuk Troubleshooting

### Kasus: Stok di POS tidak sesuai dengan yang diharapkan

1. Buka Kartu Stok
2. Cari bahan yang bermasalah
3. Periksa semua mutasi "OUT":
   - Apakah ada penjualan yang tidak wajar?
   - Apakah ada pengeluaran ganda?
   - Apakah ada SO adjustment yang tidak diketahui?
4. Periksa semua mutasi "IN":
   - Apakah supplier delivery sudah tercatat?
   - Apakah yield/produksi sudah benar?
   - Apakah mutasi dari cabang lain sudah diterima?

### Kasus: Stok negatif

Stok negatif bisa terjadi jika:

- Penjualan terjadi sebelum stok diperbarui
- Ada kesalahan pencatatan

Solusi: Lakukan stock opname untuk menyesuaikan stok.

### Kasus: Stok tidak berubah setelah transaksi

1. Cek apakah transaksi benar-benar terjadi (cek di halaman POS)
2. Cek Kartu Stok untuk tanggal tersebut
3. Jika tidak ada catatan, mungkin transaksi gagal atau dibatalkan

## Pertanyaan Umum

**Q: Kenapa ada beberapa baris dengan referensi yang sama?**
A: Karena satu transaksi bisa mempengaruhi beberapa bahan. Contoh: satu penjualan Nasi Goreng Spesial mencatat beberapa mutasi OUT (beras, ayam, telur, dll).

**Q: Apa arti referensi "PROD-xxx"?**
A: Itu adalah kode produksi internal (yield tracking). Menunjukkan bahwa pergerakan terjadi karena proses produksi.

**Q: Apa arti referensi "POS-xxx"?**
A: Itu adalah kode transaksi POS. Menunjukkan bahwa pergerakan terjadi karena penjualan.

**Q: Apa arti referensi "SD-xxx"?**
A: Itu adalah kode Supplier Delivery. Menunjukkan bahwa pergerakan terjadi karena penerimaan barang dari supplier.

**Q: Kenapa saldo bisa negatif?**
A: Saldo negatif menunjukkan stok kurang dari 0. Ini seharusnya tidak terjadi, tapi bisa muncul karena timing issue (penjualan sebelum stok diperbarui). Lakukan stock opname untuk memperbaiki.

**Q: Bisa melihat Kartu Stok untuk tanggal tertentu?**
A: Saat ini Kartu Stok menampilkan semua riwayat dari terbaru ke terlama. Gunakan scroll untuk melihat tanggal yang lebih lama.

**Q: Kenapa stok di Kartu Stok berbeda dengan stok di halaman Inventory?**
A: Seharusnya sama. Jika berbeda, mungkin ada transaksi yang belum tercatat atau ada kesalahan sistem. Lakukan stock opname untuk verifikasi.
