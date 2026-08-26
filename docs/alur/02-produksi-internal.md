# 02 — Produksi Internal (Yield Tracking)

## Kapan Digunakan?

Ketika Gudang Pusat (Central Kitchen) mengolah bahan menjadi bahan lain — misalnya bahan mentah (RM) menjadi bahan setengah jadi (SFG), atau menggabung beberapa bahan menjadi satu hasil. Contoh:

- Ayam mentah → Ayam marinasi
- Tepung + telur + gula → Adonan kue
- Tulang ayam + air + bawang → Kaldu ayam

## Siapa yang Melakukan?

- **Super Admin** atau **Central Kitchen** yang melakukan produksi
- Hanya role ini yang bisa mencatat hasil produksi

## Halaman Terkait

- `/yield-tracking` — Halaman utama untuk mencatat produksi internal

## Alur Kerja

### 1. Mencatat Produksi Baru

1. Buka halaman **Tracking Produksi** (`/yield-tracking`)
2. Klik tombol **"Input Produksi"**
3. Isi form:

   **Bagian Cabang & Tanggal:**
   - **Cabang / Gudang**: Otomatis terisi "Gudang Pusat" (tidak bisa diubah)
   - **Tanggal Produksi**: Tanggal produksi dilakukan

   **Bagian Barang Keluar (Out):**
   - Klik **"+ Tambah"** untuk menambah baris bahan yang dikeluarkan
   - Pilih **Bahan** dan isi **Jumlah** untuk setiap baris
   - Bisa lebih dari satu bahan (misal: tulang ayam + air + bawang)

   **Bagian Barang Dihasilkan (Produced):**
   - Klik **"+ Tambah"** untuk menambah baris hasil produksi
   - Pilih **Hasil** dan isi **Jumlah** untuk setiap baris
   - Bisa lebih dari satu hasil

   **Catatan:**
   - **Catatan Produksi**: Keterangan opsional

4. Klik **"Catat Produksi"**

> Satu bahan tidak boleh menjadi "keluar" sekaligus "dihasilkan" dalam produksi yang sama.

### 2. Apa yang Terjadi di Sistem?

Setelah disimpan, sistem **mencatat produksi sekaligus mengubah stok** dalam satu aksi atomik:

1. Menyimpan catatan produksi (Barang Keluar + Barang Dihasilkan) di halaman riwayat
2. **Mengurangi stok** setiap bahan keluar (Barang Keluar) di cabang tersebut
3. **Menambah stok** setiap bahan dihasilkan (Barang Dihasilkan) di cabang tersebut
4. **Menulis Kartu Stok** — mutasi "OUT" untuk setiap bahan keluar dan "IN" untuk setiap bahan dihasilkan, dengan referensi `YIELD-<id produksi>`

Stok hasil bisa menjadi **negatif** jika jumlah keluar melebihi stok saat ini — sistem tetap mencatatnya dan form menampilkan peringatan. Jika produksi **dibatalkan** (setelah permintaan batal disetujui, atau batalkan langsung oleh super_admin), mutasi stok tersebut **dibalik**: bahan keluar dikembalikan dan bahan dihasilkan dikurangi. Sistem **tidak** menghitung ulang HPP (harga pokok) bahan hasil secara otomatis — HPP diatur secara manual pada master bahan.

### 3. Melihat Riwayat Produksi

Halaman Tracking Produksi menampilkan:

- **Total Produksi**: Jumlah catatan produksi
- **Total Barang Keluar**: Total unit bahan yang dikeluarkan
- **Total Barang Dihasilkan**: Total unit bahan yang dihasilkan
- **Tabel Riwayat**: Semua catatan produksi dengan detail Barang Keluar, Barang Dihasilkan, dan Catatan

## Contoh Kasus

**Kasus**: Central Kitchen memproduksi kaldu ayam dari tulang + air + bawang

**Langkah**:

1. Buka `/yield-tracking`
2. Klik "Input Produksi"
3. Isi:
   - Tanggal Produksi: Hari ini
   - Barang Keluar: `Tulang Ayam` — 2000, `Air` — 4000, `Bawang Merah` — 200
   - Barang Dihasilkan: `Kaldu Ayam (SFG)` — 4800
   - Catatan: `Kaldu batch pagi`
4. Klik "Catat Produksi"

**Hasil**:

- Satu catatan produksi baru tersimpan di riwayat dengan Barang Keluar (tulang ayam, air, bawang merah) dan Barang Dihasilkan (kaldu ayam 4800)
- Stok **Tulang Ayam, Air, dan Bawang Merah berkurang** sesuai jumlah yang dicatat
- Stok **Kaldu Ayam (SFG) bertambah** 4800
- Kartu Stok **mencatat mutasi** — OUT untuk bahan keluar, IN untuk kaldu ayam — dengan referensi `YIELD-<id produksi>`

## Pertanyaan Umum

**Q: Apa bedanya RM, SFG, dan FG?**
A:

- **RM (Raw Material)**: Bahan mentah, belum diolah
- **SFG (Semi-Finished Good)**: Bahan setengah jadi
- **FG (Finished Good)**: Produk jadi siap jual

**Q: Bisa produksi di cabang (bukan Gudang Pusat)?**
A: Tidak. Produksi internal hanya bisa dilakukan di Gudang Pusat (Central Kitchen).

**Q: Apakah HPP bahan hasil dihitung otomatis?**
A: Tidak. Pencatatan produksi mengubah stok (bahan keluar berkurang, bahan dihasilkan bertambah) tetapi **tidak** menghitung HPP. HPP diatur manual pada master bahan.

**Q: Boleh satu produksi menghasilkan lebih dari satu bahan?**
A: Boleh. Bagian "Barang Dihasilkan" mendukung beberapa baris, begitu juga "Barang Keluar".
