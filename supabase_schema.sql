-- ==========================================================
-- SKEMA DATABASE JRC TRANS MAJALENGKA (SUPABASE POSTGRESQL)
-- ==========================================================

-- 1. Hapus tabel jika sudah ada sebelumnya
DROP TABLE IF EXISTS riwayat_bulanan CASCADE;
DROP TABLE IF EXISTS data_transaksi CASCADE;
DROP TABLE IF EXISTS data_mobil CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 2. Tabel Users (Autentikasi Multi-Role)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'investor',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabel Data Mobil (12 Unit Armada)
CREATE TABLE data_mobil (
    id SERIAL PRIMARY KEY,
    nama_mobil VARCHAR(100) NOT NULL,
    plat_nomor VARCHAR(30) UNIQUE NOT NULL,
    tahun INT DEFAULT 2022,
    kepemilikan VARCHAR(20) NOT NULL DEFAULT 'investor', -- 'investor' atau 'sendiri'
    status_sewa VARCHAR(20) DEFAULT 'Tersedia',          -- 'Tersedia', 'Disewa', 'Maintenance'
    tgl_kembali VARCHAR(30) DEFAULT '-',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabel Data Transaksi (Rincian Sewa & Biaya Operasional)
CREATE TABLE data_transaksi (
    id SERIAL PRIMARY KEY,
    mobil_id INT REFERENCES data_mobil(id) ON DELETE CASCADE,
    tanggal DATE NOT NULL,
    tgl_mulai DATE,
    tgl_kembali DATE,
    penyewa VARCHAR(100) DEFAULT '-',
    tarif NUMERIC DEFAULT 0,
    tarif_sewa NUMERIC DEFAULT 0,
    biaya_bbm NUMERIC DEFAULT 0,
    biaya_servis NUMERIC DEFAULT 0,
    biaya_lainnya NUMERIC DEFAULT 0,
    keterangan TEXT DEFAULT '-',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabel Riwayat Bulanan (Arsip Tutup Buku & Snapshot Metrik Historis)
CREATE TABLE riwayat_bulanan (
    id SERIAL PRIMARY KEY,
    periode VARCHAR(7) UNIQUE NOT NULL,       -- Format 'YYYY-MM' (contoh: '2026-08')
    nama_bulan VARCHAR(30) NOT NULL,          -- contoh: 'Agustus'
    tahun INT NOT NULL,                       -- contoh: 2026
    total_transaksi INT DEFAULT 0,
    total_pendapatan NUMERIC DEFAULT 0,       -- Total Omset
    total_biaya NUMERIC DEFAULT 0,            -- Total Biaya Ops (BBM + Servis + Lainnya)
    total_keuntungan_bersih NUMERIC DEFAULT 0,-- Omset - Biaya
    total_porsi_pengelola NUMERIC DEFAULT 0,
    total_porsi_investor NUMERIC DEFAULT 0,
    rincian_biaya JSONB DEFAULT '{}',         -- { bbm: X, servis: Y, lainnya: Z }
    rincian_unit JSONB DEFAULT '[]',          -- snapshot rincian performa tiap unit armada
    status VARCHAR(20) DEFAULT 'closed',      -- 'closed' (tutup buku resmi)
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_by VARCHAR(50) DEFAULT 'SYSTEM_AUTO'
);

CREATE INDEX IF NOT EXISTS idx_riwayat_bulanan_periode ON riwayat_bulanan(periode);

-- ==========================================================
-- SEEDING DATA AWAL (USERS, 12 MOBIL & 20 TRANSAKSI SIMULASI)
-- ==========================================================

-- A. Users Default
INSERT INTO users (id, username, password, role) VALUES
(1, 'admin', 'admin123', 'admin'),
(2, 'investor', 'investor123', 'investor'),
(3, 'supir', 'supir123', 'supir');

-- B. 15 Armada Mobil (10 Milik Sendiri & 5 Investor)
INSERT INTO data_mobil (id, nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali) VALUES
(1, 'Brio Merah Matic', 'E 1128 WN', 2026, 'sendiri', 'Tersedia', '-'),
(2, 'Brio Lemon', 'E 1569 WM', 2025, 'sendiri', 'Tersedia', '-'),
(3, 'Brio Merah', 'E 1215 WN', 2026, 'sendiri', 'Tersedia', '-'),
(4, 'Brio Putih MT', 'E 1884 WK', 2023, 'sendiri', 'Tersedia', '-'),
(5, 'Brio Merah MT', 'E 1326 WL', 2024, 'sendiri', 'Tersedia', '-'),
(6, 'Brio Merah AT', 'E 1636 WL', 2024, 'sendiri', 'Tersedia', '-'),
(7, 'Avanza New', 'E 1426 WN', 2026, 'sendiri', 'Tersedia', '-'),
(8, 'Avanza New', 'E 1761 WM', 2025, 'sendiri', 'Tersedia', '-'),
(9, 'Sigra Silver', 'E 1536 WI', 2022, 'sendiri', 'Tersedia', '-'),
(10, 'Sigra Grey Matic', 'E 1475 DZ', 2023, 'investor', 'Tersedia', '-'),
(11, 'Pick Up Futura', 'E 1809 VL', 2021, 'sendiri', 'Tersedia', '-'),
(12, 'Pick Up Gran Max', 'E 8859 VN', 2023, 'investor', 'Tersedia', '-'),
(13, 'Sigra Putih Manual', 'E 1896 WD', 2023, 'investor', 'Tersedia', '-'),
(14, 'Brio Lemon Matic', 'E 1058 WL', 2023, 'investor', 'Tersedia', '-'),
(15, 'Sigra Putih Manual 1.0', 'E 1425 WI', 2022, 'investor', 'Tersedia', '-');

-- C. 20 Transaksi Riil Seminggu
INSERT INTO data_transaksi (id, mobil_id, tanggal, tgl_mulai, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan) VALUES
(1, 1, '2026-08-10', '2026-08-10', '2026-08-10', 'Budi Santoso', 400000, 400000, 50000, 0, 0, 'Drop Bandara Kertajati'),
(2, 1, '2026-08-12', '2026-08-12', '2026-08-12', 'PT Surya Majalengka', 600000, 600000, 100000, 0, 20000, 'Sewa Dinas Kantor (Tol)'),
(3, 1, '2026-08-15', '2026-08-15', '2026-08-15', 'Hendra Wijaya', 500000, 500000, 50000, 300000, 0, 'Wisata Cirebon (Ganti Oli & Filter)'),
(4, 2, '2026-08-11', '2026-08-11', '2026-08-11', 'H. Ridwan', 1200000, 1200000, 150000, 0, 50000, 'Sewa VIP Majalengka'),
(5, 2, '2026-08-14', '2026-08-14', '2026-08-14', 'Keluarga dr. Anton', 1200000, 1200000, 150000, 0, 0, 'Drop VIP Jakarta'),
(6, 3, '2026-08-10', '2026-08-10', '2026-08-10', 'Ahmad Fauzi', 350000, 350000, 50000, 0, 0, 'Sewa Harian Dalam Kota'),
(7, 3, '2026-08-13', '2026-08-13', '2026-08-13', 'Ibu Ratna', 350000, 350000, 0, 0, 0, 'Sewa Lepas Kunci (BBM Sendiri)'),
(8, 4, '2026-08-12', '2026-08-12', '2026-08-12', 'Danang Kusuma', 450000, 450000, 50000, 0, 0, 'Kunjungan Keluarga Kuningan'),
(9, 4, '2026-08-16', '2026-08-16', '2026-08-16', 'Bpk. Trisno', 450000, 450000, 50000, 150000, 0, 'Sewa 1 Hari + Servis Rem'),
(10, 5, '2026-08-11', '2026-08-11', '2026-08-11', 'PT Telkom Majalengka', 800000, 800000, 100000, 0, 0, 'Operasional Direksi'),
(11, 5, '2026-08-15', '2026-08-15', '2026-08-15', 'Ibu Jessica', 800000, 800000, 100000, 0, 30000, 'Perjalanan Bisnis Bandung (Tol)'),
(12, 6, '2026-08-13', '2026-08-13', '2026-08-13', 'Bpk. Bambang', 1300000, 1300000, 200000, 0, 50000, 'Proyek Wisata Majalengka'),
(13, 7, '2026-08-10', '2026-08-10', '2026-08-10', 'Rombongan Guru SMP', 1100000, 1100000, 200000, 0, 50000, 'Wisata Guru ke Ciwidey'),
(14, 7, '2026-08-14', '2026-08-14', '2026-08-14', 'Keluarga Bpk. Herman', 1100000, 1100000, 200000, 400000, 0, 'Antar Pengantin + Ganti Ban Depan'),
(15, 8, '2026-08-12', '2026-08-12', '2026-08-12', 'Wedding Organizer Cirebon', 2500000, 2500000, 300000, 0, 100000, 'Mobil Pengantin VIP + Dekorasi Tol'),
(16, 9, '2026-08-15', '2026-08-15', '2026-08-15', 'Sdr. Kevin', 600000, 600000, 50000, 0, 0, 'Weekend Trip Kuningan'),
(17, 11, '2026-08-11', '2026-08-11', '2026-08-11', 'Bpk. Rahmat', 350000, 350000, 50000, 0, 0, 'Sewa Harian Cirebon'),
(18, 11, '2026-08-14', '2026-08-14', '2026-08-14', 'Ibu Dewi', 350000, 350000, 50000, 100000, 0, 'Sewa Harian + Ganti Bohlam Lampu'),
(19, 12, '2026-08-12', '2026-08-12', '2026-08-12', 'Dinas Pariwisata', 1400000, 1400000, 200000, 0, 50000, 'Studi Banding Pemda (Tol)'),
(20, 12, '2026-08-16', '2026-08-16', '2026-08-16', 'PT Indofood', 1400000, 1400000, 200000, 0, 0, 'Antar Jemput Tamu Pabrik');

-- Reset sequences to highest id
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('data_mobil_id_seq', (SELECT MAX(id) FROM data_mobil));
SELECT setval('data_transaksi_id_seq', (SELECT MAX(id) FROM data_transaksi));
