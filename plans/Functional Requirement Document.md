#

# **Functional Requirement Document (FRD)**

**Project:** Integrated POS & Deep Inventory Management System

**Consultant:** Gladbert (RICE AI Consultant)

**Date:** 29 April 2026

**Version:** 1.4 (Update based on 27 April meeting)

## **1\. Ringkasan Eksekutif**

Dokumen ini merinci kebutuhan fungsional untuk sistem POS dan manajemen stok bertingkat yang dirancang untuk mengintegrasikan operasional _Central Warehouse_ (Pusat) dengan _Branch Outlets_ (Cabang) dalam model bisnis _Ghost Kitchen_. Sistem ini mendukung operasional multi-brand dalam satu inventaris fisik, otomatisasi _supply chain_ berbasis data, dan audit stok yang ketat untuk memastikan efisiensi operasional dan akurasi finansial di bawah manajemen Omoiyari.

## **2\. Struktur Peran & Kontrol Akses (RBAC)**

Sistem menggunakan Role-Based Access Control (RBAC) dengan visibilitas antarmuka yang dibatasi (Hidden UI – modul yang tidak relevan akan dihilangkan dari layar) serta ketentuan akses periode sebagai berikut:

| Role                | Deskripsi Otoritas, Visibilitas UI, & Akses                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin**     | Pemegang kontrol fiskal & sistem penuh. Otoritas tunggal untuk membuat/mengedit HPP Menu, mengubah rumus smart-reordering, membuat diskon/voucher terpusat ke seluruh cabang, dan mengedit Invoice. Memiliki akses penuh ke Dashboard Analytics dan seluruh modul tanpa ada yang disembunyikan.                                                                                                                                                    |
| **Admin Pusat**     | Otoritas Logistik & Back-Office. Berwenang melakukan proses Purchase Requisition (PR), input ulang Surat Jalan, Edit Invoice, edit Shift History, dan pembuatan Master Menu (Nama, Kategori, Gambar). Visibilitas HPP Menu dibatasi hanya View Only (tidak bisa ubah/buat HPP). (Hidden UI: Halaman Dashboard dan Order Entry/POS dihapus total dari role ini).                                                                                    |
| **Area Manager**    | Auditor Operasional. Berwenang men-trigger Stock Opname (SO), melakukan persetujuan (Approve) untuk Mutasi Stok, Waste, dan permintaan Re-print Invoice dari kasir. Melakukan investigasi status selisih stok. Akses ke dokumen SCM (PR & Surat Jalan) dibatasi murni View Only. (Hidden UI: Dashboard, Order Entry, Shift History, Master Bahan Baku, Supply Chain, Finance Recon, Analytics, dan Administrasi Umum dihapus total dari role ini). |
| **Branch Admin**    | Pelaksana operasional harian. Melakukan transaksi POS, input penerimaan barang dari Pusat, pencatatan Waste / Broken Stock, dan request order ke pusat. (Hidden UI: Dashboard dan Shift History dihapus total dari role ini).                                                                                                                                                                                                                      |
| **Central Kitchen** | Otoritas Produksi Hulu (Central Warehouse). Memiliki hak Edit penuh pada modul Yield Tracking (penyusutan bahan mentah ke matang) dan manajemen Master Bahan Baku (Raw Material).                                                                                                                                                                                                                                                                  |

- **Branch Admin (Kasir/Gudang):**
  - Hanya dapat di-mapping ke satu (1) cabang spesifik. Akun Kasir cabang Sudirman dilarang keras bisa login atau melihat data cabang Kemang.
  - **Penyembunyian UI Cabang:** Pada akun Kasir, seluruh tabel data (Inventaris, Transaksi, dll) **tidak akan menampilkan kolom "Pilihan Cabang"**. Data otomatis terkunci dan ter-filter hanya untuk cabang tempat kasir tersebut login.
- **Area Manager (Supervisor):**
  - Dapat di-mapping ke beberapa (Multiple/Array) cabang yang menjadi tanggung jawabnya (Konsep baca data seperti _Tenant_ multi-cabang).
- **Super Admin & Admin Pusat:**
  - Memiliki akses global (All Branches) secara _default_.
- **Central Kitchen:**
  - Hanya di-mapping secara eksklusif untuk _Central Warehouse_ / Pusat Produksi.
- **Device/Session Restriction:**
  - Sistem harus membatasi 1 akun Branch Admin (Kasir) hanya memiliki 1 sesi login aktif di waktu yang bersamaan. Jika login di perangkat baru, perangkat lama otomatis ter-logout untuk mencegah kasir mengakses POS dari rumah.

## **3\. Modul Sistem (System Modules)**

1. **Modul Master Data:** Pusat kendali database untuk Manajemen Brand, SKU (Food & Non-Food), Pengguna (User), Promosi, dan Konfigurasi Cabang. Modul ini dikelola secara eksklusif oleh Super Admin dan Admin Pusat.
   1. **Visualisasi Kategori Menu (McD Style UI)**: Tampilan kategori menu pada sistem (khususnya POS) dirancang menggunakan antarmuka Tile/Visual bertingkat untuk mempercepat navigasi kasir. Kategori baku yang digunakan meliputi:
      1. Filter based on: Brand (Omoiyari atau brand lainnya), Makanan, Minuman, Snack, Paket Bundle, Add-on, etc
   2. **Brand & Menu Tagging Logic**: Karena operasional berkonsep Ghost Kitchen, sistem database wajib mendukung relasi "Many-to-Many" antara SKU Menu dan Brand.
      1. **Dedicated Menu**: Item yang spesifik hanya muncul saat kasir memilih Tab Brand tertentu (Misal: "Ayam Geprek" hanya muncul di Tab Brand A).
      2. **Shared/Global Menu**: Item pendamping (seperti Nasi Putih, Air Mineral, atau Es Teh) dapat di-tag ke Multiple Brands (Brand A, B, dan C) sehingga kasir tidak perlu mencari item yang sama di tab yang berbeda.
   3. **Brand Performance Isolation**: Meskipun inventaris fisik digabung (Shared Inventory), sistem analitik harus bisa memisahkan omzet BUKAN berdasarkan item yang terjual, melainkan berdasarkan "Dari Tab Brand mana item tersebut di-input oleh kasir".
   4. **Unit of Measure (UoM) Conversion**: Sistem wajib mendukung konversi satuan multi-level. Contoh: 1 Sak Beras \= 25 Kg \= 25.000 Gram. Pembelian via SCM menggunakan hitungan "Sak", namun pemotongan Deep Inventory menggunakan "Gram".
   5. **Bill of Materials (BOM) / Resep**: Setiap SKU (Produk Jadi) wajib memiliki resep yang mengikat ke Raw Material. Contoh: 1 Porsi Nasi Goreng Brand A \= 200g Nasi \+ 50g Ayam Mentah \+ 1 Pcs Kemasan PEX \+ 1 Sendok Plastik.
   6. **BOM Cost Roll-Up**: Jika Super Admin atau Admin Pusat melakukan update manual pada harga modal (COGS/HPP Base) suatu Raw Material (misal: harga Minyak Goreng naik), sistem wajib secara otomatis melakukan perhitungan berantai (Roll-Up Update) ke semua resep/Menu Paket yang menggunakan Minyak Goreng tersebut pada saat itu juga, tanpa perlu di-edit satu per satu.
   7. **Centralized Promo & Voucher**: Super Admin memiliki otoritas untuk membuat kampanye diskon massal (Contoh: Diskon Ramadan 15%) atau sistem Voucher (Pembelian X diskon Y%). Promo yang dibuat di pusat akan otomatis terdistribusi dan aktif di seluruh layar POS cabang tanpa perlu intervensi atau pengaturan manual dari kasir.
   8. **Menu Modification Restriction**: Hak akses untuk membuat, menghapus, atau mengubah detail Master Menu (Kategori, Nama, Harga, Gambar, Resep/BOM) dikunci mutlak hanya untuk Super Admin dan Admin Pusat.
   9. **Single Base Pricing (Bottom Price):** Menyederhanakan kompleksitas harga transaksi. Sistem menggunakan satu harga dasar (Bottom Price) yang disamakan untuk seluruh tipe pesanan (layaknya harga Offline/Dine-in). Nominal transaksi untuk distribusi channel ojol tidak perlu di- mark-up di layar kasir, melainkan menggunakan Bottom Price ini.
   10. **PIN Management Authorization**: 4-digit PIN untuk Branch Admin hanya dapat dibuat, di-reset, dan dilihat oleh Super Admin melalui Modul Master Data.
   11. **Unique PIN Constraint**: Sistem harus menolak jika Super Admin memasukkan 4-digit PIN yang sama untuk 2 user kasir yang berbeda dalam satu cabang yang sama (Mencegah overlap identitas saat pergantian shift).
   12. Setiap pendaftaran Master SKU harus mewajibkan atribut berikut:
       1. **SKU Type**: Raw Material (RM), Semi-Finished Good (SFG), atau Finished Good (FG).
       2. **SKU Category & Sub-Category**: (Misal: Kategori: Makanan, Brand: Omoiyari).
       3. **COGS / HPP Base**: Nilai modal awal (Rupiah).
       4. **Minimum Stock (ROP)**: Batas minimal untuk alert re-order.
       5. **Active/Inactive Status Toggle**: Fitur untuk menyembunyikan menu dari POS jika bahan habis secara permanen atau seasonal, tanpa menghapus riwayat datanya.
2. **Modul POS:** Antarmuka transaksi cepat (Online/Offline) dengan fitur _Request Cancel/Edit_ tersentralisasi.
   1. **Negative Stock Tolerance (Soft Block)**: Modul POS diizinkan untuk terus menjual item meskipun stok di sistem menunjukkan angka 0 (stok akan menjadi minus, misal: \-2). Hal ini untuk mengakomodasi realita lapangan di mana fisik barang sebenarnya ada, namun kasir lupa melakukan "Receive SCM" di sistem.
   2. **Negative Alert**: Setiap kali stok menembus angka minus, sistem mengirimkan notifikasi Flagging ke Area Manager.
   3. **Pajak Resto Fleksibel**: Komponen Pajak Restoran (PB1) dibuat dinamis dan dapat diatur menjadi '0' (Nihil) sesuai dengan preferensi atau regulasi yang diberlakukan owner.
   4. **Search Bar Menu**: Disediakan Search Bar spesifik di layar utama POS agar kasir dapat mencari nama produk dengan cepat di luar navigasi kategori.
   5. **Filtering**: Di layar POS Kasir, harus ada sistem Tab atau Filter di bagian atas untuk berpindah antar-filter untuk memudahkan memilih menu.
   6. **Cross-Brand Cart (Keranjang Gabungan)**: Khusus pesanan offline/takeaway, pelanggan harus bisa memesan Menu Brand A dan Menu Brand B dalam 1 nota (Keranjang Gabungan).
   7. **Modifiers & Add-ons UI**: Sistem pop-up saat item dipilih untuk modifier wajib (contoh: Level Pedas 1-5) dan modifier opsional (contoh: Tambah Telur \+Rp 5.000).
   8. **Pin Login Kasir**: Untuk alasan kecepatan operasional, Branch Admin (Kasir) menggunakan 4-digit PIN untuk otorisasi layar sentuh (bukan ketik email/password panjang).
   9. **Bundling Parent-Child Logic**: Sistem harus mendukung pembuatan "Menu Paket" (Parent SKU) yang tidak memiliki stok mandiri, melainkan memotong stok dari "Menu Satuan" (Child SKU).
      1. Contoh: Menu "Paket Kenyang" terjual. Sistem memotong BOM dari 1 Porsi Nasi Goreng (Brand A) \+ 1 Es Teh (Brand B).
   10. **Standby UI \- 3 Pesanan Terakhir**: Layar POS wajib membiarkan 3 riwayat pesanan terakhir tetap tampil di layar utama (Sebelah kiri/kanan antarmuka) untuk kemudahan pantauan operasional.
   11. **Dropdown Detail & Re-Print Approval**: Pada riwayat pesanan, terdapat fitur Dropdown (panah bawah) untuk melihat detail (Allow to see details). Terdapat tombol Re-print Invoice (Cetak Ulang Struk), TETAPI eksekusinya akan terkunci dan memunculkan pop-up permintaan otorisasi (Approval) ke Supervisor (Area Manager) sebelum printer menyala.
   12. **Print Bill Button**: Sistem POS menyediakan tombol "Print Bill" (Cetak Tagihan Sementara) yang bisa ditekan kasir sebelum transaksi diselesaikan atau dibayar oleh pelanggan.
3. **Modul Deep Inventory:** Pelacakan stok real-time, manajemen batch, yield tracking, dan kartu stok (_Stock Ledger_).
   1. **Add-ons & Modifier BOM**: Fitur Modifiers (seperti Extra Keju, Extra Telur) tidak hanya berfungsi sebagai label/teks di nota, tetapi wajib berstatus sebagai SKU komposit yang memiliki BOM sendiri untuk memotong Raw Material (RM) secara independen.
   2. **Exclusion Logic (Minus Modifier)**: Jika kasir menginput Note/Modifier berupa penolakan bahan (Contoh: "Tanpa Telur" pada menu Nasi Goreng Spesial), sistem harus memiliki kapabilitas untuk mengembalikan/membatalkan potongan 1 butir telur dari BOM standar Nasi Goreng Spesial tersebut agar stok fisik tidak selisih kurang.
   3. **Tampilan & Filter Sederhana:**
      1. Setiap halaman inventaris dan Stock Ledger wajib menggunakan sistem Pagination (1 Halaman \= 10-15 Item maksimal) agar data tidak berat saat dimuat.
      2. Terdapat Search Bar dan fitur Sortir (Sort) di setiap halaman rekap stok.
      3. Filter kategori barang dibakukan menjadi: Dry (Kering), Fresh (Segar), Packaging (Kemasan), dan ditambahkan satu filter khusus untuk Bahan Baku.
   4. **Logical Branch Masking**: Khusus untuk akun Branch Admin (Kasir), tabel kolom "Cabang" dihapus/disembunyikan dari antarmuka. Saat Kasir login, sistem secara backend otomatis memfilter semua tampilan data (Inventory, Ledger, dll) murni Hanya untuk cabangnya sendiri (Contoh: Login SBY Barat ➔ Semua data SBY Barat, tidak perlu memilih cabang).
4. **Modul Supply Chain (SCM):** Mengatur alur permintaan barang dari cabang ke pusat (Central Warehouse) dengan siklus dokumen hierarkis.
   1. **Alur Dokumen Baku**: Siklus distribusi wajib melewati tahapan sistematis: (1) Cabang Order (PR) ➔ (2) PO ➔ (3) Surat Jalan (SJ) ➔ (4) Invoice.
   2. **Purchase Requisition (PR) Berbasis Data**: Fitur "Riwayat Pemesanan" (Order History) cabang dipindahkan dan digabung ke dalam halaman PR. Form PR wajib memunculkan kolom "Sisa Stok Aktual" di samping kolom jumlah yang ingin diorder, agar kasir memiliki acuan data sebelum meminta barang ke pusat.
5. **Modul Waste & Shrinkage:** Pencatatan barang rusak, jatah makan, dan _broken stock_ (kemasan terbuka).
   1. **Side-by-Side Broken Stock UI**: Halaman input Broken Stock (Barang Rusak) didesain menyerupai form Stock Opname. Antarmuka menyandingkan "Daftar Broken Stock" secara visual berdampingan (side-by-side) dengan indikator "Barang Keluar / Stok Habis" untuk mempermudah audit visual oleh Area Manager.
   2. **Kategorisasi Beban Baku**: Input penyusutan/kerugian wajib menggunakan tiga (3) kategori tetap:
      1. Beban Makan (Jatah karyawan)
      2. Biaya Operasional (Kerusakan/kehilangan operasional harian)
      3. Spoiled (Basi/Hancur)
   3. **Link Integrasi Khusus**: Data yang di-input dengan kategori "Biaya Operasional" wajib memiliki relasi tautan (Link) langsung yang masuk ke dalam pencatatan laporan Broken Stock.
6. **Modul Audit & SO:** Antarmuka verifikasi fisik harian dengan fitur _discrepancy highlight_ (\>3%).
   1. **Dedicated SO Page**: Dibuatkan halaman dan kategori spesifik untuk proses pelaksanaan Stock Opname. Aturan sistem: Form SO tidak boleh di-submit dalam keadaan kosong (Blank Submit).
   2. **Status 'Investigasi'**: Jika terdapat selisih (Variance) antara stok fisik yang di-input cabang dengan jumlah di sistem database, status SKU tersebut akan otomatis berubah menjadi "Investigasi".
   3. **Trigger Tracking**: Proses SO hanya bisa di-trigger (dimulai) oleh Area Manager atau Admin Pusat. Sistem wajib mencatat riwayat log: Siapa (User ID) yang men-trigger SO tersebut beserta timestamp-nya.
7. **Modul Finance & Reconciliation:** Input uang cair rekening, rekapitulasi biaya operasional, dan kalkulasi margin.
   1. **Input Uang Cair**: Admin Pusat menginput nominal masuk dari setiap channel aplikasi.
   2. **Gross Profit Calculator**: Omzet Bruto \- Total HPP (berdasarkan nilai transaksi).
8. **Modul Period Control:** Kendali pembukaan dan penutupan buku (EOD/EOM) eksklusif Super Admin.
   1. **Ketentuan Periode (Lock):**
      1. **Super Admin**: Bypass Lock; tetap memiliki akses tulis/edit meskipun periode berstatus Closed.
      2. **Selain Super Admin**: Restricted; Akses tulis dikunci jika periode Closed.
9. **Modul Analytics & Reporting:** Modul ini dikelola penuh oleh Super Admin untuk memberikan gambaran strategis operasional bisnis (Akan dirinci pada Bagian 6 Dokumen ini). Meliputi Top Sales Chart, Ekspor PDF Dashboard, dan Rekap Ledger Historis.

## **4\. Alur Kerja Detail (Workflow)**

### **4.1 Workflow Super Admin: Manajemen Periode & Fiskal (Modul 8 & 9\)**

- **Proses Buka Buku (Open Period):**
  1. **Data Presentation:** Sebelum membuka periode, sistem menyajikan **Pre-Open Report** yang berisi: (a) Saldo akhir stok periode lalu per cabang, (b) Daftar harga bahan baku terbaru, (c) Status integrasi platform ojol.
  2. **System Side:** Sistem memeriksa tabel Period_Logs. Jika periode sebelumnya sudah Closed, sistem menyalin Closing_Balance menjadi Opening_Balance pada **Modul Deep Inventory**.
  3. **User Action:** Super Admin menekan "Start New Period". Akses tulis untuk Admin Pusat, AM, dan Branch Admin otomatis terbuka.
- **Proses Tutup Buku (Period Closing):**
  1. **Exhaustive Verification Step:** Sistem menampilkan checklist verifikasi wajib:
     - **Inventory:** Apakah semua SO harian di semua cabang sudah status Approved di **Modul Audit**?
     - **Waste:** Apakah semua laporan selisih \> 5% sudah memiliki komentar investigasi?
     - **Finance:** Apakah ada Invoice SCM di **Modul SCM** yang masih berstatus Pending (belum dikonfirmasi Paid/Unpaid)?
     - **Transactions:** Apakah ada antrian _Cancel Request_ di **Modul POS** yang belum diproses?
  2. **Reporting Insight:** Menyajikan **Closing Preview Report** (Estimasi Net Revenue & Total Loss akibat Waste).
  3. **User Action:** Menekan tombol "Finalize & Lock".
  4. **Operational Impact:** **Modul POS, SCM, dan Inventory** terkunci bagi user lain (Read-only). Super Admin tetap dapat melakukan koreksi jika ditemukan kesalahan fatal (Full Access).
  5. **Negative Inventory Check**: Modul Period Control akan mengunci/memblokir tombol "Finalize & Lock" (Tutup Buku harian) jika masih ada SKU di cabang yang berstatus minus. Branch Admin wajib melakukan Stock Opname (Adjustment) atau menyelesaikan penerimaan SCM terlebih dahulu untuk menormalkan stok minus menjadi minimal 0 sebelum bisa tutup buku.

### **4.2 Workflow Admin Pusat: Produksi & Distribusi (Modul 3 & 4\)**

- **Workflow Produksi Manual (Modul 3):**
  1. **RM Deduction:** Admin Pusat masuk ke **Modul Deep Inventory**, memilih menu "Manual Stock Out" untuk Raw Material (RM). Admin wajib menginput kuantitas dan menambahkan **Catatan Produksi** (misal: "Pengolahan 20kg Ayam Mentah").
  2. **SFG/FG Input:** Setelah pengolahan selesai, Admin melakukan "Manual Stock In" untuk produk matang (FG) atau setengah jadi (SFG).
  3. **System Side:** Sistem mencatat kedua transaksi ini dalam Kartu Stok dengan referensi nota produksi yang sama agar alur pengurangan RM dan penambahan FG dapat dilacak oleh auditor.
- **Alur SCM & Distribusi Terintegrasi:**

1. **Purchase Requisition (PR):** Cabang mengajukan order berdasarkan rekomendasi sistem atau manual.
   1. **Edit Limit Cabang:** Cabang masih diizinkan untuk mengedit (revisi kuantitas) daftar orderan mereka selama form PR tersebut belum diproses oleh Pusat.
   2. **Proses Pusat:** Terminologi 'Approve' untuk orderan cabang diganti menjadi tombol "Proses". Setelah Admin Pusat menekan tombol "Proses", hak edit dari sisi Cabang otomatis terkunci mutlak.
2. **Surat Jalan Digital:** Admin Pusat menerbitkan dokumen pengiriman.
   1. **Input Ulang Parameter**: Saat menerbitkan SJ, Admin Pusat wajib menginput ulang form Surat Jalan dengan format 3 pilar: (Jumlah Diorder | Jumlah Ready | Jumlah Dikirim).
   2. **Update Status SJ (Edit Limit)**: Admin Pusat tetap diberikan hak untuk melakukan edit Surat Jalan selama barang fisiknya belum diberangkatkan (Status Update SJ).
   3. **In-Transit Virtual Warehouse**: Saat Admin Pusat mengonfirmasi pengiriman, stok masuk ke status In-Transit (Gudang Virtual) hingga diterima Cabang.
3. **Fase Terima Cabang (Penerimaan Fisik):**
   1. Cabang menerima barang fisik dan wajib menginput Total Terima Barang ke dalam sistem.
   2. Reject & Retur: Jika ada barang rusak atau tidak sesuai, cabang wajib memasukkannya ke dalam kolom Reject Item / Barang Retur di form penerimaan tersebut.
4. **Fase Final Invoicing:**
   1. **Actual Base:** Sistem akan menerbitkan Invoice secara otomatis yang nominalnya disesuaikan murni berdasarkan Jumlah Barang yang Aktual Diterima oleh Cabang (Bukan berdasarkan jumlah diorder/dikirim).
   2. **Allow Edit Invoice:** Otoritas untuk melakukan revisi/Edit Invoice secara manual HANYA diberikan kepada Super Admin dan Admin Pusat jika terjadi kondisi diskrepansi khusus.

- **Manajemen Keuangan:**
  1. **Update HPP:** Admin Pusat mengupdate HPP per menu secara berkala (fleksibel terhadap perubahan harga bahan).
  2. **Input Revenue:** Admin Pusat menginput uang masuk secara manual untuk menghitung Margin Kotor harian.

### **4.3 Workflow Area Manager: Supervisi & Audit (Modul 5, 6, & 2\)**

- **Audit SO (Modul 6):**
  1. **SO Trigger**: Area Manager berwenang untuk men-trigger (memulai) proses Stock Opname untuk cabang di bawahnya. Sistem wajib mencatat Audit Trail berisi "Siapa (User ID) yang men-trigger SO tersebut".
  2. **Status Investigasi**: Sistem menghitung stok ekspektasi secara background. Jika saat disubmit oleh Cabang terdapat selisih (Variance), SKU tersebut otomatis ditandai dan berubah statusnya menjadi "Investigasi".
  3. **Validation**: Area Manager melakukan investigasi atas status tersebut dan menekan "Approve" (Penyesuaian) jika alasan dapat diterima, atau menolak jika harus hitung ulang di barang tertentu.
- **Otorisasi Pembatalan (Modul 2):**
  1. **Approval SCM:** Setiap mutasi stok antar-cabang atau permintaan khusus wajib melalui Approval (Persetujuan) dari Area Manager untuk memvalidasi kebutuhan, yang selanjutnya status ini ter-update untuk diketahui oleh Admin Pusat

### **4.4 Workflow Branch Admin: Operasional & Inventory (Modul 2, 5, & 6\)**

- **Workflow Manajemen Pesanan (Modul 2):**
  1. **Online Flow:** Input Kode Order Ojol (Mandiri/Integrasi). Tanpa struk, stok terpotong. Langkah wajib kasir:
     - Pilih Platform (ShopeeFood/Grab/Gojek).
     - Input Order ID.
     - Klik Menu Utama.
     - Sistem memunculkan layar Add-ons (Contoh: Extra Keju, Level Pedas). Kasir wajib menyesuaikan Add-ons sesuai layar HP Driver.
     - Kasir mengetik Catatan Pembeli (Contoh: "Pisah sambal", "Jangan pakai sayur") di kolom Note khusus item tersebut.
     - **Review Cart**: Sistem menampilkan ringkasan pesanan (Menu \+ Add-ons \+ Notes) sebelum kasir menekan tombol "Submit", untuk dicocokkan kembali dengan aplikasi driver.
  2. **Offline Flow:** Input Nama Pemesan, pilih metode bayar. Struk thermal tercetak (Hanya Offline). Langkah wajib kasir:
     - Pilih Platform (Offline).
     - Input Nama Customer.
     - Klik Menu Utama.
     - Sistem memunculkan layar Add-ons (Contoh: Extra Keju, Level Pedas). Kasir wajib menyesuaikan Add-ons sesuai permintaan pembeli.
     - Kasir mengetik Catatan Pembeli (Contoh: "Pisah sambal", "Jangan pakai sayur") di kolom Note khusus item tersebut.
     - **Review Cart**: Sistem menampilkan ringkasan pesanan (Menu \+ Add-ons \+ Notes) sebelum kasir menekan tombol "Submit", untuk dicocokkan kembali dengan kemauan pembeli.
  3. **Cancel:** Menekan "Request Cancel" jika salah input atau alasan lainnya, akan mengeluarkan request approval untuk pembatalannya.
  4. **Guided Shopee-Style UI Flow (Online dan Offline)**: Antarmuka input pesanan bagi kasir dirancang menyerupai User Experience (UX) pelanggan saat memesan di aplikasi ShopeeFood. Saat kasir memilih menu utama, sistem wajib memunculkan Pop-up Modal yang memaksa kasir untuk:
     - Memilih Add-ons / Modifiers (opsional maupun wajib dan bisa mengubah harga akhir).
     - Mengisi kolom "Notes / Catatan Pembeli" secara spesifik per item (bukan sekadar catatan global di akhir nota).
- **Workflow Waste & Meals (Modul 5):**
  1. **Kategorisasi Baku**: Input pengurangan stok barang yang tidak terjual HANYA BISA menggunakan 3 kategori berikut (Logika/Kategori Expired dihapus):
     - Beban Makan (Jatah konsumsi karyawan).
     - Biaya Operasional (Kerusakan operasional).
     - Spoiled (Basi/Hancur).
  2. **Link ke Broken Stock**: Setiap item yang di-input cabang dengan kategori "Biaya Operasional" wajib terhubung (auto-link) ke daftar Broken Stock yang tampilan antarmukanya disandingkan dengan barang keluar/habis.
  3. **Automated Waste Valuation**: Setiap input Waste otomatis dikalikan dengan HPP Master Terbaru.
- **Workflow Restocking (Modul 4):**
  1. Melihat indikator **ROP** dan **ROQ** di dashboard, lalu mengirimkan PR ke Pusat.
  2. **Blind Stock Opname (SO) UI**: Saat Branch Admin melakukan tugas penghitungan fisik harian/mingguan (Input SO), layar POS/Backoffice HANYA menampilkan daftar nama Item dan kolom input Qty kosong. Sistem dilarang keras menampilkan "Ekspektasi Stok Sistem" di layar Branch Admin.
     - Untuk memastikan kedisiplinan input, sistem MENGUNCI tombol Submit jika form halaman Stock Opname masih dalam keadaan kosong (Blank Submit tidak diizinkan).
  3. **Variance Calculation**: Perhitungan selisih (Input Fisik vs Ekspektasi Sistem) hanya dieksekusi di background database setelah form di-submit, dan hasilnya hanya dapat dilihat oleh Area Manager di Modul Audit untuk diinvestigasi.
- **Workflow Buka/Tutup Shift:**
  1. **Open Shift**: Kasir wajib menginput "Modal Awal Laci" (Cash Float) sebelum bisa menggunakan POS.
  2. **Close Shift**: Kasir menginput "Uang Fisik Aktual" yang ada di laci.
  3. **Blind Close**: Kasir tidak boleh melihat "Ekspektasi Uang di Sistem" saat menginput fisik. Setelah input, sistem membandingkan: (Modal Awal \+ Transaksi Cash) vs (Uang Fisik Aktual).
  4. **Variance Log**: Jika ada selisih (kurang/lebih), sistem mencatatnya sebagai Cash Discrepancy yang dilaporkan ke Area Manager.

### **4.5 Workflow Otorisasi Pembatalan & Edit Order (Modul 2\)**

Setiap permintaan pembatalan atau perubahan data pesanan wajib melalui jalur otorisasi:

- **Hierarki Akses Otoritas**: Fitur Approve/Reject pada Cancel Request, Edit Order, maupun permintaan Re-print Invoice (Cetak ulang struk lama) dikunci secara mutlak pada level database. Tombol persetujuan HANYA dapat diakses oleh akun dengan Role: Master, Pusat, atau Supervisor
- **Kategori Alasan Pembatalan Wajib (Dropdown list)**: Branch Admin yang mengajukan request wajib memilih salah satu dari 3 alasan baku berikut (tidak boleh input teks bebas untuk alasan utama):
  1. Stok Habis
  2. Salah Input
  3. Customer Cancel
- **Log Transaksi Permanen (Audit Trail)**: Sistem wajib merekam log pembatalan dengan struktur data yang dapat ditarik laporannya: \[Timestamp Request\] | \[Nama Branch Admin Pemohon\] | \[Nama Approver: Master/Pusat/Supervisor\] | \[Alasan Pembatalan\] | \[Detail Item yang Dibatalkan\].

### **4.6 Workflow Finance: Real-time Profitability (Modul 7\)**

Mengintegrasikan data penjualan dengan uang masuk di rekening:

- **Input Uang Cair:** Admin menginput nominal uang yang masuk ke rekening secara harian berdasarkan laporan per aplikasi (Grab, Shopee, Gofood, Offline).
- **Kalkulasi Gross Profit:**
  - Total Omzet (Uang Cair) \- Total HPP (Berdasarkan menu terjual) \= Margin/Gross Profit.
- **Monitoring HPP:** Sistem memberikan _alert_ jika HPP suatu menu melampaui 40% dari harga jual (akibat promo berlebih atau kenaikan harga bahan).
- **Tax & Discount Calculation Base:** Sistem harus membedakan basis perhitungan Pajak Restoran (PB1 10%) berdasarkan tipe diskon:
- **Merchant-Funded Discount (Diskon Resto):** PB1 dihitung setelah subtotal dipotong diskon. (Contoh: Harga 100k, diskon resto 20k. PB1 10% dihitung dari 80k \= 8k).
- **Platform-Funded Discount (Diskon Ojol):** PB1 dihitung dari sebelum diskon/harga awal, karena diskon ditanggung pihak aplikasi dan uang akan cair penuh ke resto.
- **MDR (Merchant Discount Rate) Deduction:** Sistem keuangan wajib memiliki field persentase komisi per platform (misal: ShopeeFood 20%, Grab 20% \+ Rp1.000). Omzet Netto harian di dashboard bukan sekadar total penjualan harga mark-up, melainkan: (Total Gross Sales) \- (Merchant Diskon) \- (Estimasi Potongan MDR Ojol).
- **Historical COGS Snapshot**: Saat sebuah transaksi POS selesai (Status: Completed), sistem wajib menyimpan "Snapshot/Copy" dari nilai HPP item tersebut tepat pada detik transaksi itu terjadi ke dalam tabel riwayat transaksi (Transaction_Log).
- **Lock Logic**: Laporan Finansial masa lalu (contoh: Laba Kotor bulan Januari) harus dihitung berdasarkan Snapshot HPP bulan Januari. Perubahan/Update HPP Master yang dilakukan Admin Pusat di bulan Februari TIDAK BOLEH mengubah angka laba kotor transaksi yang sudah terjadi di bulan Januari.

## **5\. Arsitektur Inventaris & Logika Pengadaan**

### **5.1 Deep Inventory & Yield Tracking**

- **Yield Tracking:** Pencatatan penyusutan berat bahan (misal: Ayam mentah ke Ayam goreng) saat pengolahan di Pusat. (Catatan Hak Akses: Hak untuk mengedit dan mengelola mutasi pada modul Yield Tracking ini diotorisasi secara khusus untuk role Central Kitchen).
- **Shared Inventory:** Mendukung operasional multi-brand dalam satu lokasi fisik tanpa pemisahan stok fisik (logical separation only).
- **Yield Costing Formula**: Sistem harus menghitung ulang HPP produk matang (FG) berdasarkan berat akhir aktual setelah penyusutan, BUKAN berdasarkan berat mentah.
  - **Skenario Sistem**: Admin Pusat menginput "Keluar 10 Kg Ayam Mentah (Total HPP Rp 300.000)". Setelah digoreng, Admin menginput "Masuk 8 Kg Ayam Matang".
  - **Kalkulasi Otomatis**: Sistem wajib membagi total nilai modal dengan kuantitas matang: Rp 300.000 / 8 Kg \= Rp 37.500 / Kg. Angka Rp 37.500 inilah yang akan otomatis menjadi HPP dasar (Base COGS) terbaru untuk Ayam Matang di Master Data.

### **5.2 Manajemen Biaya Operasional (Non-Food)**

Sistem melacak penggunaan barang habis pakai (seperti pada tabel referensi):

- **Kategori Barang**: Galon, LPG, Minyak, PEX (Kemasan), Plastik Klip, Spons, Sealer Cup, Tissue, Baterai, dll.
- **Input Pengeluaran**: Pencatatan biaya tetap bulanan (Gaji, Listrik & Air, Sewa/Service Charge, Biaya Makan Staff).
- **Integrasi Waste Operasional**: Setiap pemotongan stok/inventaris yang dialokasikan khusus untuk kategori "Biaya Operasional" wajib terhubung (auto-link) secara langsung ke dalam pencatatan laporan Broken Stock, sehingga data barang keluar selaras dengan data kerusakan.

### **5.3 Algoritma Smart Reordering (Smart Ordering Logic)**

Sistem menggunakan logika pengadaan berdasarkan siklus pengiriman 2x seminggu.

- **Formula:** (Rata-rata keluar stok per hari) × 5 hari.
- **Otoritas Perubahan Rumus**: Sistem wajib menyediakan opsi/parameter untuk mengganti variabel rumus pengadaan di atas (misal diubah menjadi 7 hari x 3 hari). Namun, hak akses untuk mengganti/mengedit rumus tersebut dikunci secara mutlak HANYA untuk Super Admin dan Admin Pusat.
- **Flexibility:** Hasil perhitungan ini bersifat **rekomendasi**. Tim cabang diberikan wewenang untuk menyesuaikan jumlah order secara manual jika stok fisik di lapangan sudah sangat menipis.
- **MOQ & Unit Enforcement**: Dalam kalkulasi Purchase Requisition (PR) otomatis dari Cabang ke Pusat, sistem harus mematuhi batas Minimum Order Quantity (MOQ) per item yang di-set di Master Data.
  - Contoh: Jika rata-rata keluar stok beras \= 3 Kg/hari, untuk 5 hari sistem merekomendasikan 15 Kg. Namun jika MOQ Gudang Pusat untuk Beras adalah "1 Sak (25 Kg)", maka rekomendasi sistem harus otomatis dibulatkan ke atas menjadi 1 Sak (25 Kg), tidak boleh mengirim pecahan (misal 0.6 Sak).

## **6\. Modul Analytics & Reporting (Exhaustive)**

### **6.1 Laporan Penjualan (Sales Reports)**

- **Sales Summary:** Omzet bruto & netto (harian/mingguan/bulanan).
- **Channel & Brand Performance:** Profitabilitas per platform dan kontribusi brand.
- **Hourly Heatmap:** Analisis beban kerja dapur berdasarkan jam pesanan.
- **Margin Kotor Harian:** Terhitung dari (Uang Masuk Manual \- HPP Terupdate).
- **HPP Monitoring:** Alert otomatis untuk menu dengan persentase HPP di bawah 40% (akibat dampak promo/iklan aplikator) guna langkah antisipasi.

### **6.2 Laporan Inventaris & Audit (Inventory Reports)**

- **Stock Ledger:** Riwayat mutasi lengkap per SKU.
- **Discrepancy Report:** Daftar selisih stok fisik \> 3% beserta catatan investigasi AM.
- **Comprehensive Waste Report:** Detail kerugian berdasarkan kategori (Broken, Expired, dll).
- **Audit Trail Logs**: Setiap tindakan pembatalan pesanan, perubahan harga bahan (HPP), dan approval surat jalan SCM wajib direkam dalam log tersembunyi (Database Level) yang mencatat: Timestamp, User_ID, Action, Old_Value, dan New_Value

### **6.3 Laporan Finansial (Financial Reports)**

- **Net Revenue Tracking:** Pendapatan bersih setelah biaya komisi platform.
- **COGS & Margin:** Analisis laba berdasarkan penggunaan bahan aktual (BOM).
- **Branch Debt Status:** Rekapitulasi Invoice SCM Unpaid untuk pemantauan piutang internal.
- **Waste Financial Categorization**:
  - **Waste kategori "Spoiled" & "Biaya Operasional"** \= Dicatat di laporan keuangan sebagai Operational Loss (Kerugian).
  - **Waste kategori "Beban Makan" \=** Dicatat sebagai Staff Benefit Expense (Biaya Karyawan).

### **6.4 Dashboard Visual**

(Catatan: Akses ke antarmuka Dashboard dihapus untuk semua role selain Super Admin. Fitur Search Bar / Search Data global di halaman Dashboard juga dihapus).

- **Pie Chart Penjualan**: Persentase kontribusi channel (Grab vs Shopee vs Gofood vs Offline/Dine-in).
- **Top Sales Chart (Volume Penjualan Global)**: Grafik batang untuk 5-10 menu paling laku harian.
  - **Filter Fleksibel**: Grafik wajib dilengkapi dropdown filter berdasarkan Cabang/Branch dan Kategori Menu (Semua/All, Makanan, Minuman, Snack, Paket Bundle, Add-on).
  - **Data Masking**: Grafik ini HANYA menampilkan jumlah kuantitas (quantity) keluar per item.

### **6.5 Export & Spreadsheet Integration**

- **PDF Export Function**: Sistem menyediakan fitur cetak langsung (Print PDF) untuk layar Dashboard (Super Admin) dan ekspor laporan Audit Stock / Stock Opname ke dalam format PDF untuk pengarsipan.
- **Automatic Formatting (.xlsx):** Seluruh data dapat diunduh dalam format .xlsx yang kolomnya sudah disesuaikan dengan format Google Sheets Owner:
  - **Kolom**: Tanggal, Nama Item, HPP, Jumlah per Channel, Total Jumlah, Total HPP, Omzet, Margin, Gross Profit.
- **Operational Tracking**: Data pemakaian non-food (misal: pemakaian plastik) dapat diekspor terpisah untuk evaluasi efisiensi bulanan.

### **6.6 Parameter Optimasi Laporan**

- **Server-Side Pagination**: Semua tampilan data dalam bentuk tabel (Stock Ledger, Discrepancy Report, Transaksi History) wajib menggunakan Server-Side Pagination (melakukan penarikan data secara bertahap).
- **Spesifikasi Halaman Inventaris & Ledger**: Khusus untuk halaman data Inventory dan Stock Ledger, batas penarikan diatur menjadi 10-15 baris (item) per halaman.
  - DILARANG KERAS menarik seluruh data (fetch all) sekaligus dari database ke browser.
- **Date-Range Query Constraint**: Modul Analytics dan Ekspor Spreadsheet wajib memiliki pembatasan rentang waktu maksimal. User (termasuk Super Admin) tidak diizinkan menarik Laporan Transaksi Detail lebih dari 31 hari (1 Bulan) dalam satu kali proses komputasi (Query). Jika butuh data 1 tahun, harus ditarik per bulan.

## **7\. Spesifikasi Output (Printing)**

### **7.1 Struk Kasir POS (Kertas Thermal 58mm/80mm):**

- **Header:** Logo Brand (Dinamis sesuai item yang dibeli / Logo Omoiyari jika mix brand), Alamat Cabang, Tanggal & Waktu, Nama Kasir.
- **Identitas Transaksi:** Nomor Order Internal, Nomor Ref Ojol (Jika online), Tipe Pesanan (Takeaway/Dine-in/Ojol).
- **Body (Item List):** Nama Menu, _Modifiers_ tertera di bawah menu dengan indentasi (misal: \- Level Pedas 3), Qty, Harga Satuan, Diskon Item, Subtotal Item.
- **Summary:** Subtotal, Diskon Total, PB1 (Pajak), Grand Total.
- **Payment & Footer:** Metode Bayar (Cash/QRIS/OVO), Uang Dibayar, Kembalian, Pesan _Greeting_ / _Password_ WiFi.

### **7.2 Surat Jalan SCM (Kertas A4 \- Cetak 2 Rangkap):**

- **Header:** Logo Perusahaan Pusat, "SURAT JALAN & TRANSFER STOK", No. Dokumen (Auto-generate DO-YYMMDD-XXXX), Tanggal Kirim, Asal (Gudang Pusat), Tujuan (Nama Cabang).
- **Person In Charge:** Nama Admin Pusat, Nama Kurir/Driver, Nomor Plat Kendaraan.
- **Tabel Item:** No | Kode SKU | Nama Item | Batch/Expired Date | UoM (Satuan) | **Qty Dikirim** | **\[Kolom Kosong: Qty Diterima\]** | **\[Kolom Kosong: Catatan/Kondisi\]**.
- **Footer (3 Kolom Tanda Tangan):** (1) Disiapkan Oleh (Admin Pusat), (2) Dikirim Oleh (Kurir), (3) Diterima Oleh (Branch Admin). _Wajib mencantumkan Nama Terang dan Tanggal Terima._

## **8\. Additional Notes**

### **8.1 Notes from prototype:**

Notes 27 April:

- Sidebar:
  - Add some categorization into the side bar item, add dropdown that categorize things
- RBAC
  - Superadmin: everything
  - Admin pusat:
    - Partial access: Stock opname khusus central warehouse, inventory read only on central warehouse
    - Full access: Purchase requisition, surat jalan, invoice, supply chain
  - Branch Admin:
    - Partial access: order entry, stock opname, purchase requisition, surat jalan, mutasi stock (from and to), waste, inventory on their specific branch
  - Area manager:
    - Partial access: inventory, stock opname, mutasi stock on their specific area branch. Purchase requisition, surat jalan, waste read only
  - Central kitchen:
    - Partial access: inventory, stock opname, wasteon central werehouse
    - Full access: supply chain, yield tracking
- Module:
  - Shrinkage module delete aja
  - Mutasi stock logic need to align with current surat jalan and approval to area manager, etc
- Role:
  - Branch admin:
    - Ensure pengurangan e nde surat jalan invoice dkk align, if the branch admin edit the received product at their branch, the stock out in the central warehouse need to adjust to that number
    - Mutasi stock need to have similar logic but only to surat jalan (no need invoice and purchase requisition)

* Dashboard Module
  - Delete cari data search bar on top right screen
  - Delete Avg Cooking Time in dashboard
  - Fix Distribusi Channel UI, Categorization does not show up
  - Add dedicated page for riwayat pemesanan and add details modal, filtering, search bar for this page, reprint action, edit, etc
  - This is for Super admin only
* Order Entry Module (POS)
  - Direct WA change to Dine-in
  - Kode order ojol, change to “Notes”. If Dine-in, fill with customer name, if Gofood, grabfood, shopeefood fill with kode ojol
  - Cabang dropdown only exist in super admin, branch admin will have static value for cabang
  - This is for branch admin & super admin only
  - Remove diskon merchant & diskon platform & pajak restoran
  - Add voucher where kasir can add in the voucher added by Super Admin
  - Pesanan terakhir only last 3 order
  - Filtering system in the menu list: Brand (omoiyari, omoiyara), Type (makanan, minuman, snack, add ons)
  - Search text box for menu
* Shift History \- Delete module
* Inventory:
  - No need FIFO, expiry related stuff
  - Add pagination, filtering based on kategori, cabang (for admin pusat, area manager, super admin), search bar for stock saat ini and kartu stock (stock ledger)
  - This is for super admin, area manager (can filter with cabang) and branch admin, admin pusat (cannot filter with cabang)
* Stock Opname:
  - Pilih cabang only applies to Super admin, area manager
  - Admin pusat can only choose central warehouse
  - Branch admin can only choose branch admin
  - Branch admin & admin pusat have blind SO, meaning they CANNOT see expected value (value in digital warehouse). They can only submit and view the progress
  - Super admin & area manager: can have see through SO, meaning they CAN see expected value (value in digital warehouse). They can submit and view the progress, and also mark the SO to be Approved and Under Investigation.
  - SO Submission cannot be rejected, however, super admin and area manager can change the detail in the submission based on their discussion with the branch admin
  - There is filtering and search bar within the SO interface, and everything needed to be filled (only countable item)
* Purchase Requisition & Surat Jalan & Invoice SCM
  - There is clickable modal to see the details, cuz item right now will overflow the table and is a bad UI
  - See the logic flow above on 4.2. Basically, branch admin can submit request, but while they are in pending state, they can change around the submission. If the admin pusat / super admin have already change the state to processed, only they can edit the submission, the branch admin can only see. If the surat jalan is printed and sent, the inventory is being held under transit (the stock does not just move instantly). If the item arrived, branch admin have control to check the surat jalan and the actual item arrived and can changed the surat jalan in their system and can reject if the item is not in the SOP (broken or not within the correct weight). The invoice can be written if both admin pusat and branch admin already reviewed the latest surat jalan.
  - Branch admin can submit, and edit when the item arrived
  - Admin pusat can process and change when the order is being processed.
  - Super admin can do everything
  - Area manager can only see the state of the submission and the details
* Mutasi stock (within branch)
  - Branch admin can do mutasi stock from branch to branch or branch to pusat, but they need approval from area manager or super admin
  - Same logic with the Purchase Requisition & Surat Jalan & Invoice SCM, but this one they need approval first before the submission can be submitted
* Waste & Shrinkage
  - Pisahkan jadi 2 module. Waste untuk specifically add waste product: rusak, jatah makan karyawan
  - And shrinkage for xxx. need further discussion
* SCM
  - This is for admin pusat and super admin only
  - Action: CRUD, and print
* Yield Tracking:
  - for new role only: Central Kitchen and Super Admin
* Bahan baku:
  - for new role only: Central Kitchen and Super Admin
* Finance & Reconciliation
  - For super admin only
* Analytics:
  - Combine with dashboard, no need hourly kitchen workload
* Administrasi:
  - Need further discussion
* General logic
  - Some item is divided into countable and uncountable:
    - Countable: nasi ayam teriyaki, bowl mangkok plastic, tutup plastic, Galon air, pack sedotan 100 biji, pack sendok plastic 50 biji, Es pack etc
    - Uncountable: sedotan per pcs, sendok plastic per pcs, galon yang sudah dibuka
  - Uncontable item itu adalah broken stock. Barang stock yg sudah dibuka. Nnti dalam SO, uncountable tidak masuk dalam item yang perlu dicek.

| RICE AI Consultant           | Omoiyari (Owner)                 |
| :--------------------------- | :------------------------------- |
| **Gladbert Sogo** Consultant | **David Senjaya** Business Owner |
