# 04 — Mutasi Stok (Transfer Antar Cabang)

## Kapan Digunakan?

Ketika satu cabang kehabisan stok dan perlu meminjam atau meminta dari cabang lain. Berbeda dengan Pengadaan (dari Gudang Pusat), Mutasi Stok terjadi **antar cabang**.

## Siapa yang Melakukan?

- **Cabang Pengirim**: Branch Admin di cabang yang mengirim stok
- **Cabang Penerima**: Branch Admin di cabang yang menerima stok
- **Area Manager**: Menyetujui mutasi antar cabang

## Halaman Terkait

- `/stock-transfers` — Halaman utama untuk melihat dan mengelola mutasi stok

## Alur Kerja

### 1. Cabang Penerima Membuat Permintaan

1. Buka halaman **Mutasi Stok** (`/stock-transfers`)
2. Klik tombol **"Buat Mutasi"**
3. Isi form:
   - **Cabang Pengirim**: Pilih cabang yang akan mengirim
   - **Cabang Penerima**: Otomatis terisi cabang Anda
   - **Bahan**: Pilih bahan yang dibutuhkan
   - **Jumlah**: Masukkan jumlah yang diminta
4. Klik **"Simpan"**

Status: **Draft** → **Pending AM Review**

### 2. Area Manager Menyetujui

1. Area Manager melihat permintaan masuk
2. Mengecek ketersediaan stok di cabang pengirim
3. Memutuskan:
   - **Setujui**: Status berubah ke **Approved**
   - **Tolak**: Status berubah ke **Rejected**

### 3. Cabang Pengirim Menyiapkan dan Mengirim

1. Branch Admin cabang pengirim melihat permintaan yang disetujui
2. Menyiapkan barang
3. Membuat Surat Jalan
4. Mengirim barang: Status berubah ke **In Transit**

### 4. Cabang Penerima Menerima

1. Barang sampai di cabang penerima
2. Branch Admin membuka detail mutasi
3. Mengisi form penerimaan:
   - Cocokkan jumlah yang diterima
   - Catat jika ada selisih
4. Klik **"Konfirmasi Penerimaan"**

Status: **Delivered** → **Reviewing SJ**

### 5. Review dan Invoice

1. Branch Admin mereview Surat Jalan final
2. Sistem membuat invoice otomatis
3. **Cabang penerima membayar ke cabang pengirim** (bukan ke supplier)
4. Status: **Waiting for Payment** → **Finished**

## Apa yang Terjadi di Sistem?

Selama proses mutasi, sistem mencatat:

1. **Saat pengiriman (In Transit)**:
   - Stok di cabang pengirim berkurang
   - Stok masuk "in-transit inventory"

2. **Saat penerimaan (Delivered)**:
   - Stok dalam perjalanan berkurang
   - Stok di cabang penerima bertambah
   - Kartu Stok mencatat mutasi di kedua cabang

3. **Saat invoice dibuat**:
   - Harga per unit = HPP bahan di cabang pengirim saat Surat Jalan dibuat
   - Total invoice = jumlah diterima × harga per unit
   - Cabang penerima "membayar" ke cabang pengirim

## Perbedaan dengan Pengadaan

| Aspek               | Pengadaan                    | Mutasi Stok                              |
| ------------------- | ---------------------------- | ---------------------------------------- |
| **Dari**            | Gudang Pusat                 | Cabang lain                              |
| **Ke**              | Cabang                       | Cabang lain                              |
| **Yang menyetujui** | Admin Pusat                  | Area Manager                             |
| **Pembayaran**      | Cabang bayar ke Gudang Pusat | Cabang penerima bayar ke cabang pengirim |
| **Harga**           | HPP di Gudang Pusat          | HPP di cabang pengirim                   |

## Contoh Kasus

**Kasus**: Cabang Surabaya kehabisan saus sambal, minta 20 botol dari Cabang Malang

**Langkah**:

1. Branch Admin Surabaya buat mutasi:
   - Cabang Pengirim: `Cabang Malang`
   - Bahan: `Saus Sambal (FG)`
   - Jumlah: `20`
2. Area Manager review dan setujui
3. Branch Admin Malang siapkan barang, kirim
4. Barang sampai, Branch Admin Surabaya terima 20 botol
5. Sistem buat invoice: 20 × HPP saus sambal di Malang

**Hasil**:

- Stok saus sambal di Malang berkurang 20
- Stok saus sambal di Surabaya bertambah 20
- Surabaya "berutang" ke Malang sebesar invoice

## Status Mutasi Stok

| Status                  | Arti                              | Siapa yang Bertindak |
| ----------------------- | --------------------------------- | -------------------- |
| **Draft**               | Permintaan baru dibuat            | Cabang Penerima      |
| **Pending AM Review**   | Menunggu persetujuan Area Manager | Area Manager         |
| **Approved**            | Disetujui, menunggu pengiriman    | Cabang Pengirim      |
| **In Transit**          | Barang sedang dikirim             | —                    |
| **Delivered**           | Barang sampai                     | Cabang Penerima      |
| **Reviewing SJ**        | Mereview Surat Jalan              | Cabang Penerima      |
| **Waiting for Payment** | Menunggu pembayaran               | Cabang Penerima      |
| **Finished**            | Selesai                           | —                    |
| **Rejected**            | Ditolak oleh Area Manager         | —                    |
| **Cancelled**           | Dibatalkan                        | —                    |

## Pertanyaan Umum

**Q: Kenapa harus disetujui Area Manager?**
A: Karena mutasi stok mempengaruhi stok di dua cabang. Area Manager memastikan kedua cabang benar-benar butuh dan mampu.

**Q: Bagaimana kalau cabang pengirim tidak punya stok cukup?**
A: Area Manager bisa menolak permintaan. Cabang penerima bisa minta dari Gudang Pusat (Pengadaan) sebagai alternatif.

**Q: Bisa kirim ke beberapa cabang sekaligus?**
A: Tidak. Satu mutasi = satu cabang pengirim → satu cabang penerima. Buat beberapa mutasi jika perlu kirim ke banyak cabang.

**Q: Bagaimana kalau barang yang diterima rusak?**
A: Cabang penerima mencatat jumlah yang diterima dalam kondisi baik. Barang rusak bisa dicatat sebagai waste.

**Q: Kenapa harga di invoice berbeda dari harga di Gudang Pusat?**
A: Karena harga diambil dari HPP bahan di cabang pengirim, bukan di Gudang Pusat. Setiap cabang bisa punya HPP yang berbeda tergantung kapan mereka menerima stok.
