# 06 — Stock Opname (Penghitungan Stok Fisik)

## Kapan Digunakan?

Secara berkala (biasanya setiap bulan) untuk memverifikasi bahwa stok fisik di gudang/cabang sesuai dengan catatan sistem. Ini adalah proses **audit stok**.

## Siapa yang Melakukan?

- **Area Manager** atau **Admin Pusat**: Memicu (trigger) stock opname
- **Branch Admin** atau **Central Kitchen**: Menghitung stok fisik
- **Area Manager** atau **Super Admin**: Menyetujui hasil

## Halaman Terkait

- `/stock-opname` — Halaman utama untuk melihat dan mengelola stock opname

## Alur Kerja

### 1. Pemicuan (Trigger)

1. Supervisor (Area Manager/Admin Pusat) membuka halaman Stock Opname
2. Klik **"Trigger Stock Opname"**
3. Pilih cabang dan tanggal
4. Klik **"Mulai"**

Sistem akan:

- Mencatat semua bahan yang ada di cabang tersebut
- Membuat daftar hitung dengan stok sistem sebagai referensi
- Mengunci stok sistem pada saat pemicuan (tidak berubah selama proses SO)

### 2. Penghitungan Fisik

1. Counter (Branch Admin/Central Kitchen) membuka detail SO
2. Melihat daftar bahan yang perlu dihitung
3. Mengisi **stok fisik** untuk setiap bahan:
   - Hitung secara fisik di gudang
   - Masukkan jumlah yang sebenarnya ada
4. Klik **"Submit"**

**Mode Blind**: Counter **tidak bisa melihat stok sistem**. Ini untuk mencegah bias saat menghitung.

### 3. Review dan Investigasi

Setelah submit, supervisor mereview:

1. **Variance (Selisih)** = Stok Fisik - Stok Sistem
   - **Positif (+)**: Stok fisik lebih banyak dari sistem (surplus)
   - **Negatif (-)**: Stok fisik lebih sedikit dari sistem (kurang)

2. Supervisor memutuskan:
   - **Langsung setujui**: Jika selisih kecil dan wajar
   - **Investigasi**: Jika selisih besar, minta counter hitung ulang

### 4. Investigasi (Jika Diperlukan)

1. Status berubah ke **"Under Investigation"**
2. Counter diminta menghitung ulang bermasalah
3. Counter bisa memperbaiki angka
4. Supervisor review lagi

### 5. Persetujuan (Approval)

1. Supervisor menyetujui hasil SO
2. Sistem menyesuaikan stok sistem sesuai stok fisik
3. Kartu Stok mencatat penyesuaian sebagai "SO Adjustment"

**Penting**: Setelah disetujui, stok sistem = stok fisik. Ini adalah **satu-satunya cara** untuk mengubah stok sistem tanpa transaksi normal.

### 6. Realisasi (Tanggal 25)

Stock opname yang sudah disetujui bisa **di-realize** pada tanggal 25:

1. Hanya bisa dilakukan oleh Super Admin
2. Hanya pada tanggal 25
3. Menerapkan penyesuaian stok secara permanen

## Contoh Kasus

**Kasus**: Cabang Surabaya melakukan stock opname bulan Juli

**Langkah**:

1. Area Manager trigger SO untuk Cabang Surabaya
2. Counter di Surabaya menghitung stok fisik:
   - Ayam Mentah: Sistem 50, Fisik 48 (selisih -2)
   - Tepung: Sistem 100, Fisik 100 (selisih 0)
   - Minyak Goreng: Sistem 30, Fisik 32 (selisih +2)
3. Counter submit hasil
4. Area Manager review:
   - Ayam Mentah: -2 wajar (susut alami)
   - Minyak Goreng: +2 perlu investigasi
5. Area Manager minta hitung ulang minyak goreng
6. Counter hitung ulang, ternyata ada 1 botol tersembunyi
7. Counter perbaiki: Minyak Goreng = 31 (selisih +1)
8. Area Manager setujui
9. Sistem sesuaikan stok:
   - Ayam Mentah: 50 → 48
   - Minyak Goreng: 30 → 31

## Status Stock Opname

| Status                  | Arti                               | Siapa yang Bertindak |
| ----------------------- | ---------------------------------- | -------------------- |
| **Draft**               | Baru dipicu, menunggu penghitungan | Counter              |
| **Submitted**           | Sudah dihitung, menunggu review    | Supervisor           |
| **Under Investigation** | Perlu hitung ulang                 | Counter              |
| **Approved**            | Disetujui, stok disesuaikan        | —                    |

## Pertanyaan Umum

**Q: Berapa sering harus stock opname?**
A: Idealnya setiap bulan, tapi tergantung kebutuhan bisnis. Beberapa cabang mungkin perlu lebih sering.

**Q: Kenapa mode "blind" (tidak bisa lihat stok sistem)?**
A: Untuk mencegah counter "mengikuti" angka sistem. Penghitungan harus berdasarkan apa yang benar-benar ada di fisik.

**Q: Apa yang terjadi dengan selisih stok?**
A: Setelah SO disetujui, stok sistem disesuaikan sesuai stok fisik. Selisih dicatat di Kartu Stok sebagai "SO Adjustment".

**Q: Bagaimana kalau selisihnya sangat besar?**
A: Supervisor akan meminta investigasi lebih lanjut. Selisih besar bisa mengindikasikan masalah (pencurian, kesalahan pencatatan, dll).

**Q: Bisa stock opname untuk beberapa cabang sekaligus?**
A: Tidak. Setiap SO untuk satu cabang saja. Buat beberapa SO jika perlu audit beberapa cabang.

**Q: Apa itu "realize" pada tanggal 25?**
A: Realisasi adalah proses final yang menerapkan penyesuaian SO secara permanen. Hanya bisa dilakukan tanggal 25 oleh Super Admin. Ini memberi waktu untuk klarifikasi sebelum perubahan final.
