# 05 — Resep dan POS (Point of Sale)

## Kapan Digunakan?

Untuk memahami bagaimana resep (produk yang dijual) muncul di kasir dan bagaimana stok otomatis berkurang saat ada penjualan.

## Konsep Penting

### Resep = Bill of Materials (BOM)

Setiap resep memiliki **BOM** — daftar bahan dan takaran yang dibutuhkan. Contoh:

**Resep: Nasi Goreng Spesial**

- Beras: 200g
- Ayam Marinasi: 100g
- Telur: 2 butir
- Minyak Goreng: 15ml
- Kecap Manis: 10ml
- Bawang Merah: 20g

### Resep Muncul di POS Jika Bahan Tersedia

**Aturan utama**: Resep hanya muncul di kasir jika **semua bahan** dalam BOM tersedia di stok cabang tersebut.

Contoh:

- Jika stok ayam marinasi habis, resep Nasi Goreng Spesial **tidak akan muncul** di kasir
- Jika semua bahan tersedia, resep **muncul** dan bisa dijual

## Alur Penjualan di POS

### 1. Kasir Memilih Resep

1. Kasir membuka halaman POS
2. Melihat daftar resep yang tersedia (hanya yang bahan lengkap)
3. Memilih resep yang dipesan pelanggan

### 2. Pelanggan Memilih Modifier (Opsional)

Jika resep punya modifier (add-on atau exclusions):

- **Add-on**: Menambah bahan (contoh: extra telur, extra keju)
- **Exclusion**: Mengurangi bahan (contoh: tanpa bawang)

### 3. Sistem Menghitung Kebutuhan Bahan

Sistem otomatis menghitung semua bahan yang dibutuhkan:

```
Bahan untuk Nasi Goreng Spesial:
- Beras: 200g
- Ayam Marinasi: 100g
- Telur: 2 butir (BOM) + 1 butir (extra telur modifier) = 3 butir
- Minyak Goreng: 15ml
- Kecap Manis: 10ml
- Bawang Merah: 0g (exclusion: tanpa bawang)
```

### 4. Sistem Mengecek Stok

Sebelum menambahkan ke pesanan, sistem mengecek:

- Apakah semua bahan tersedia?
- Apakah jumlahnya cukup?

Jika **tidak cukup**, kasir akan melihat peringatan dan item tidak bisa ditambahkan.

### 5. Transaksi Terjadi

Saat pembayaran dikonfirmasi:

1. **Stok berkurang otomatis** untuk setiap bahan yang digunakan
2. **Kartu Stok mencatat** setiap pengurangan sebagai mutasi "OUT"
3. **HPP tercatat** untuk perhitungan laba

## Contoh Kasus

**Kasus**: Pelanggan memesan Nasi Goreng Spesial dengan extra telur, tanpa bawang

**Langkah di POS**:

1. Kasir pilih "Nasi Goreng Spesial"
2. Pilih modifier: "Extra Telur" (+1 butir)
3. Pilih modifier: "Tanpa Bawang" (-20g bawang merah)
4. Tambahkan ke pesanan
5. Proses pembayaran

**Apa yang terjadi di sistem**:

Stok berkurang:

- Beras: -200g
- Ayam Marinasi: -100g
- Telur: -3 butir (2 BOM + 1 extra)
- Minyak Goreng: -15ml
- Kecap Manis: -10ml
- Bawang Merah: 0 (excluded)

Kartu Stok mencatat:

```
OUT 200g — POS-12345: Nasi Goreng Spesial (Beras)
OUT 100g — POS-12345: Nasi Goreng Spesial (Ayam Marinasi)
OUT 3 — POS-12345: Nasi Goreng Spesial (Telur)
OUT 15ml — POS-12345: Nasi Goreng Spesial (Minyak Goreng)
OUT 10ml — POS-12345: Nasi Goreng Spesial (Kecap Manis)
```

## HPP (Harga Pokok Penjualan)

HPP resep = total biaya semua bahan dalam BOM

Contoh:

- Beras 200g × Rp 100/g = Rp 20.000
- Ayam Marinasi 100g × Rp 500/g = Rp 50.000
- Telur 2 butir × Rp 2.000/butir = Rp 4.000
- Minyak Goreng 15ml × Rp 100/ml = Rp 1.500
- Kecap Manis 10ml × Rp 200/ml = Rp 2.000
- Bawang Merah 20g × Rp 150/g = Rp 3.000
- **Total HPP = Rp 80.500**

Jika harga jual Rp 45.000, maka:

- HPP: Rp 80.500 (ini contoh, sebenarnya HPP harus lebih rendah dari harga jual)
- Harga Jual: Rp 45.000
- **Margin = (Harga Jual - HPP) / Harga Jual × 100%**

> **Catatan**: HPP dihitung otomatis oleh sistem. Jika HPP berubah (misalnya harga bahan naik), HPP resep dihitung ulang otomatis.

## Pertanyaan Umum

**Q: Kenapa resep saya tidak muncul di POS?**
A: Cek stok bahan di cabang tersebut. Jika ada bahan yang stoknya 0 atau kurang, resep tidak akan muncul. Tambah stok melalui Pengadaan atau Mutasi Stok.

**Q: Bagaimana kalau stok bahan kurang dari yang dibutuhkan?**
A: Resep tidak bisa dijual. Kasir akan melihat peringatan stok tidak cukup. Solusi: tambah stok dulu.

**Q: Apakah stok berkurang saat pesanan dibuat atau saat pembayaran?**
A: Saat pembayaran dikonfirmasi. Sebelum itu, stok belum berubah.

**Q: Bagaimana kalau pesanan dibatalkan setelah pembayaran?**
A: Sistem akan mengembalikan stok (restorasi) untuk setiap bahan yang sudah dikurangi.

**Q: Kenapa HPP resep berubah padahal saya tidak mengedit resep?**
A: Karena HPP dihitung dari harga bahan terkini. Jika harga bahan berubah (misalnya setelah supplier delivery), HPP resep dihitung ulang otomatis.

**Q: Apa itu modifier "exclusion"?**
A: Exclusion mengurangi bahan dari resep. Contoh: "Tanpa bawang" berarti bawang merah tidak dikurangi dari stok (dan tidak ditambahkan ke makanan).

**Q: Bagaimana resep bundle/paket bekerja?**
A: Resep bundle adalah resep yang berisi resep lain (child recipes). Saat bundle dijual, semua bahan dari semua resep di dalamnya dikurangi dari stok.
