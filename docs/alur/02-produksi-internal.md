# 02 — Produksi Internal (Yield Tracking)

## Kapan Digunakan?

Ketika Gudang Pusat (Central Kitchen) mengolah bahan mentah (RM) menjadi bahan setengah jadi (SFG). Contoh:

- Ayam mentah → Ayam marinasi
- Tepung + telur + gula → Adonan kue
- Sayuran mentah → Sayuran yang sudah dicuci dan dipotong

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

   **Bagian Bahan Mentah (Input):**
   - **Cabang / Gudang**: Otomatis terisi "Gudang Pusat" (tidak bisa diubah)
   - **Tanggal Produksi**: Tanggal produksi dilakukan
   - **Bahan**: Pilih bahan mentah yang diolah
   - **Jumlah**: Masukkan jumlah bahan mentah yang digunakan

   > Jika menggunakan beberapa bahan mentah, klik **"+ Tambah Bahan"** untuk menambah baris baru

   **Bagian Hasil Produksi (Output):**
   - **Hasil Matang (SFG/FG)**: Pilih bahan hasil produksi
   - **Jumlah Hasil**: Masukkan jumlah yang dihasilkan

   **Catatan:**
   - **Catatan Produksi**: Keterangan opsional (contoh: "Pengolahan batch pagi")

4. Klik **"Catat Produksi"**

### 2. Apa yang Terjadi di Sistem?

Setelah Anda menyimpan, sistem otomatis:

1. **Mengurangi stok** bahan mentah di Gudang Pusat
2. **Menambah stok** bahan hasil (SFG/FG) di Gudang Pusat
3. **Mencatat di Kartu Stok**:
   - Bahan mentah: mutasi "OUT" (keluar)
   - Bahan hasil: mutasi "IN" (masuk)
4. **Menghitung HPP** bahan hasil berdasarkan:
   ```
   HPP Baru = Total Biaya Bahan Mentah ÷ Jumlah Hasil
   ```
5. **Menghitung ulang HPP** semua resep yang menggunakan bahan hasil
6. **Menghitung yield dan shrinkage**

### 3. Memahami Yield dan Shrinkage

- **Yield (Persentase Hasil)**: Berapa persen bahan mentah yang menjadi hasil
  - Contoh: 1000g ayam mentah → 800g ayam matang = Yield 80%
- **Shrinkage (Susut)**: Berapa banyak bahan yang hilang dalam proses
  - Contoh: 1000g - 800g = 200g shrinkage

**Tips**: Yield yang rendah (< 80%) perlu diteliti. Mungkin ada masalah dalam proses produksi.

### 4. Melihat Riwayat Produksi

Halaman Tracking Produksi menampilkan:

- **Total Produksi**: Jumlah catatan produksi
- **Rata-rata Yield**: Persentase yield rata-rata
- **Total Shrinkage**: Total susut keseluruhan
- **Tabel Riwayat**: Semua catatan produksi dengan detail

## Contoh Kasus

**Kasus**: Central Kitchen mengolah 5kg ayam mentah menjadi ayam marinasi

**Langkah**:

1. Buka `/yield-tracking`
2. Klik "Input Produksi"
3. Isi:
   - Tanggal Produksi: Hari ini
   - Bahan Mentah: `Ayam Mentah (RM)` — Jumlah: `5000`
   - Hasil Matang: `Ayam Marinasi (SFG)` — Jumlah Hasil: `4500`
   - Catatan: `Marinasi batch pagi`
4. Klik "Catat Produksi"

**Hasil**:

- Stok ayam mentah berkurang 5000
- Stok ayam marinasi bertambah 4500
- Kartu Stok mencatat:
  - `OUT 5000 — Yield: Ayam Mentah → produksi`
  - `IN 4500 — Yield: produksi → Ayam Marinasi`
- HPP ayam marinasi dihitung ulang: (HPP ayam mentah × 5000) ÷ 4500
- Yield: 90%, Shrinkage: 500

## Pertanyaan Umum

**Q: Apa bedanya RM, SFG, dan FG?**
A:

- **RM (Raw Material)**: Bahan mentah, belum diolah (contoh: ayam mentah, tepung)
- **SFG (Semi-Finished Good)**: Bahan setengah jadi, sudah diolah tapi belum siap jual (contoh: ayam marinasi, adonan)
- **FG (Finished Good)**: Produk jadi siap jual (contoh: nasi goreng jadi)

**Q: Bisa produksi di cabang (bukan Gudang Pusat)?**
A: Tidak. Produksi internal hanya bisa dilakukan di Gudang Pusat (Central Kitchen).

**Q: Bagaimana kalau hasil produksi lebih banyak dari bahan mentah?**
A: Itu tidak mungkin secara fisik. Jumlah hasil pasti lebih kecil atau sama dengan jumlah bahan mentah (ada susut/shrinkage).

**Q: Kenapa HPP berubah setelah produksi?**
A: Karena HPP bahan hasil = total biaya bahan mentah ÷ jumlah hasil. Jika yield rendah, HPP per unit akan lebih tinggi.

**Q: Apa yang terjadi dengan resep yang menggunakan bahan hasil?**
A: HPP semua resep tersebut dihitung ulang otomatis. Harga jual resep tidak berubah, tapi margin keuntungan bisa berubah.
