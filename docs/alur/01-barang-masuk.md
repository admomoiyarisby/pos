# 01 — Barang Masuk dari Supplier

## Kapan Digunakan?

Ketika Gudang Pusat menerima kiriman bahan mentah dari supplier. Ini adalah **cara utama** untuk menambah stok bahan mentah di Gudang Pusat.

## Siapa yang Melakukan?

- **Super Admin** atau **Admin Pusat** yang mencatat penerimaan barang
- Hanya role ini yang bisa membuat, mengedit, atau menghapus catatan barang masuk

## Halaman Terkait

- `/supplier-deliveries` — Halaman utama untuk mencatat dan melihat barang masuk

## Alur Kerja

### 1. Mencatat Barang Masuk Baru

1. Buka halaman **Barang Masuk** (`/supplier-deliveries`)
2. Klik tombol **"Catat Barang Masuk"**
3. Isi form:
   - **Nama Supplier**: Ketik nama supplier (bisa pilih dari daftar yang sudah ada)
   - **Bahan Baku**: Pilih bahan yang diterima dari dropdown
   - **Jumlah**: Masukkan jumlah yang diterima
   - **Total Harga**: Masukkan total harga pembelian (dalam Rupiah)
4. Klik **"Simpan"**

### 2. Apa yang Terjadi di Sistem?

Setelah Anda menyimpan, sistem otomatis:

1. **Menambah stok** bahan tersebut di Gudang Pusat
2. **Mencatat di Kartu Stok** sebagai mutasi "IN" (masuk)
3. **Menghitung ulang HPP** semua resep yang menggunakan bahan tersebut
4. **Mencatat audit log** untuk jejak pemeriksaan

### 3. Mencetak Invoice

Setiap catatan barang masuk bisa dicetak sebagai invoice penerimaan barang:

1. Klik ikon **printer** di kolom Aksi
2. Invoice akan terbuka di tab baru
3. Cetak menggunakan browser (Ctrl+P / Cmd+P)

### 4. Mengedit atau Menghapus

- Klik ikon **pensil** untuk mengedit catatan
- Klik ikon **tempat sampah** untuk menghapus (stok akan otomatis dikurangi)

## Contoh Kasus

**Kasus**: Supplier "PT Ayam Segar" mengirim 50kg ayam mentah seharga Rp 750.000

**Langkah**:

1. Buka `/supplier-deliveries`
2. Klik "Catat Barang Masuk"
3. Isi:
   - Nama Supplier: `PT Ayam Segar`
   - Bahan Baku: `Ayam Mentah (RM)`
   - Jumlah: `50`
   - Total Harga: `750000`
4. Klik "Simpan"

**Hasil**:

- Stok ayam mentah di Gudang Pusat bertambah 50
- Kartu Stok mencatat: `IN 50 — Supplier Delivery: PT Ayam Segar`
- HPP semua resep yang pakai ayam mentah dihitung ulang

## Pertanyaan Umum

**Q: Bisa catat barang masuk untuk cabang (bukan Gudang Pusat)?**
A: Tidak. Barang masuk dari supplier selalu masuk ke Gudang Pusat. Untuk mengirim ke cabang, gunakan fitur **Pengadaan** (lihat [03-pengadaan.md](./03-pengadaan.md)).

**Q: Bagaimana kalau supplier mengirim beberapa bahan sekaligus?**
A: Buat satu catatan per bahan. Misalnya, jika supplier mengirim ayam dan tepung, buat 2 catatan terpisah.

**Q: Bagaimana kalau harga berubah dari yang dijanjikan?**
A: Catat harga yang sebenarnya dibayar. HPP akan dihitung ulang otomatis berdasarkan harga terakhir.

**Q: Apa itu status "Pending Invoice"?**
A: Status default saat barang masuk dicatat. Bisa diubah ke "Completed" setelah invoice dari supplier diterima dan dicocokkan.
