# JRC Trans Majalengka - Sistem Pembukuan & Manajemen Rental Mobil

Aplikasi pembukuan rental mobil, pengelolaan armada, dan pembagian hasil laba bersih 70% Investor : 30% Pengelola JRC Trans secara real-time.

---

## Cara Menjalankan Aplikasi

### Cara 1: Sangat Mudah (Cukup 1 Klik di Windows)
Klik dua kali pada file **`start.bat`**. Aplikasi akan otomatis membuka browser di `http://localhost:3000`.

### Cara 2: Melalui Terminal / Command Prompt
1. Pastikan **Node.js** sudah terinstal di komputer.
2. Buka folder ini di Terminal / CMD.
3. Jalankan perintah:
   ```bash
   npm install
   npm start
   ```
4. Buka browser dan kunjungi: **`http://localhost:3000`**

---

## Akun Login Bawaan

| Role | Username | Password | Hak Akses |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Akses penuh: Kelola armada, input transaksi, edit transaksi, hapus, kelola user, cetak PDF. |
| **Investor** | `investor` | `investor123` | Akses baca: Dashboard performa, pemantauan unit investor, dan laporan bagi hasil. |

---

## Fitur Utama

1. **Dashboard Analitik**: Ringkasan performa finansial, widget live status armada, grafik tren omset harian, perbandingan pendapatan unit, dan rasio bagi hasil.
2. **Kelola Armada**: Input unit mobil baru (Milik Sendiri / Investor), live status ketersediaan (*Tersedia, Disewa, Servis*) dan tanggal selesai sewa.
3. **Input & Edit Transaksi**: Pencatatan transaksi sewa, BBM, servis, biaya lainnya, serta fitur edit & hapus transaksi.
4. **Laporan & PDF Bagi Hasil**: Perhitungan otomatis bagi hasil 70:30 dengan filter periode (Hari Ini, 7 Hari, Bulan Ini, Custom Tanggal) dan unduh cetak PDF format landscape resmi.
5. **Multi-User**: Admin dapat mendaftarkan akun baru untuk investor maupun staf admin tambahan melalui menu profil.
