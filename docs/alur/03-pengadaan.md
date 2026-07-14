# 03 — Pengadaan (Central → Cabang)

## Kapan Digunakan?

Ketika cabang kehabisan stok dan perlu dikirim dari Gudang Pusat. Ini adalah **cara utama** untuk mendistribusikan bahan dari pusat ke cabang.

## Siapa yang Melakukan?

- **Branch Admin (BA)**: Membuat permintaan (PR) dan menerima barang
- **Admin Pusat (CA)**: Meninjau permintaan, mengirim barang, membuat invoice
- **Area Manager**: Tidak terlibat langsung dalam pengadaan (hanya untuk mutasi stok)

## Halaman Terkait

- `/scm-procurements` — Halaman utama untuk melihat dan mengelola pengadaan
- `/scm-procurements/new` — Membuat permintaan pengadaan baru

## Alur Kerja

### 1. Branch Admin Membuat Permintaan (PR)

1. Buka halaman **Pengadaan** (`/scm-procurements`)
2. Klik tombol **"Buat Permintaan"**
3. Isi form:
   - Pilih bahan yang dibutuhkan
   - Masukkan jumlah yang diminta
   - Tambahkan catatan jika perlu
4. Klik **"Simpan"**

Status permintaan: **Draft** → **Pending**

### 2. Admin Pusat Meninjau Permintaan

1. Admin Pusat melihat permintaan masuk di halaman `/scm-procurements`
2. Mengecek ketersediaan stok di Gudang Pusat
3. Memutuskan:
   - **Setujui**: Status berubah ke **Under Review**
   - **Tolak**: Status berubah ke **Rejected** (permintaan ditutup)

### 3. Admin Pusat Menyiapkan dan Mengirim Barang

1. Setelah disetujui, Admin Pusat menyiapkan barang
2. Mengisi Surat Jalan (SJ) dengan detail pengiriman
3. Mengirim barang: Status berubah ke **In Transit**

### 4. Branch Admin Menerima Barang

1. Barang sampai di cabang
2. Branch Admin membuka detail pengadaan
3. Mengisi form penerimaan:
   - Cocokkan jumlah yang diterima dengan Surat Jalan
   - Catat jika ada selisih (kurang/lebih)
4. Klik **"Konfirmasi Penerimaan"**

Status: **Delivered** → **Reviewing SJ**

### 5. Review dan Invoice

1. Branch Admin mereview Surat Jalan final
2. Sistem membuat invoice otomatis berdasarkan jumlah yang diterima
3. Status: **Waiting for Payment** → **Finished**

## Apa yang Terjadi di Sistem?

Selama proses pengadaan, sistem mencatat:

1. **Saat pengiriman (In Transit)**:
   - Stok di Gudang Pusat berkurang
   - Stok masuk "in-transit inventory" (stok dalam perjalanan)

2. **Saat penerimaan (Delivered)**:
   - Stok dalam perjalanan berkurang
   - Stok di cabang bertambah
   - Kartu Stok mencatat mutasi di kedua cabang

3. **Saat invoice dibuat**:
   - Harga per unit diambil dari HPP bahan saat permintaan dibuat
   - Total invoice = jumlah diterima × harga per unit

## Contoh Kasus

**Kasus**: Cabang Mulyorejo kehabisan ayam marinasi, minta 50 unit dari Gudang Pusat

**Langkah**:

1. Branch Admin Cabang Mulyorejo buat permintaan:
   - Bahan: `Ayam Marinasi (SFG)`
   - Jumlah: `50`
2. Admin Pusat review dan setujui
3. Admin Pusat siapkan barang, buat Surat Jalan, kirim
4. Barang sampai, Branch Admin terima 50 unit
5. Sistem buat invoice otomatis

**Hasil**:

- Stok ayam marinasi di Gudang Pusat berkurang 50
- Stok ayam marinasi di Cabang Mulyorejo bertambah 50
- Kartu Stok di kedua cabang mencatat pergerakan

## Status Pengadaan

| Status                  | Arti                                  | Siapa yang Bertindak |
| ----------------------- | ------------------------------------- | -------------------- |
| **Draft**               | Permintaan baru dibuat, belum dikirim | Branch Admin         |
| **Pending**             | Permintaan menunggu review            | Admin Pusat          |
| **Under Review**        | Sedang ditinjau oleh Admin Pusat      | Admin Pusat          |
| **In Transit**          | Barang sedang dikirim                 | —                    |
| **Delivered**           | Barang sampai di cabang               | Branch Admin         |
| **Reviewing SJ**        | Branch Admin mereview Surat Jalan     | Branch Admin         |
| **Waiting for Payment** | Menunggu pembayaran                   | Branch Admin         |
| **Finished**            | Selesai                               | —                    |
| **Rejected**            | Ditolak oleh Admin Pusat              | —                    |
| **Cancelled**           | Dibatalkan                            | —                    |

## Pertanyaan Umum

**Q: Berapa lama proses pengadaan?**
A: Tergantung jarak dan ketersediaan barang. Umumnya 1-3 hari kerja.

**Q: Bagaimana kalau barang yang diterima kurang dari yang dikirim?**
A: Branch Admin mencatat jumlah yang sebenarnya diterima. Invoice dibuat berdasarkan jumlah diterima, bukan jumlah dikirim.

**Q: Bisa minta barang dari cabang lain (bukan Gudang Pusat)?**
A: Itu namanya **Mutasi Stok**, bukan Pengadaan. Lihat [04-mutasi-stok.md](./04-mutasi-stok.md).

**Q: Bagaimana kalau Gudang Pusat tidak punya stok?**
A: Admin Pusat bisa menolak permintaan atau menunggu stok dari supplier (lihat [01-barang-masuk.md](./01-barang-masuk.md)).

**Q: Kenapa harga di invoice bisa berbeda dari harga terakhir?**
A: Harga diinvoice adalah harga saat permintaan dibuat, bukan harga terkini. Ini untuk menjaga kepastian harga.
