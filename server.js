require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');

// Pastikan tipe data DATE PostgreSQL (OID 1082) selalu dibaca sebagai string 'YYYY-MM-DD'
// tanpa terpengaruh pergeseran timezone UTC vs WIB
types.setTypeParser(1082, str => str);

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'secret_key_jrctrans_majalengka';

app.use(cors());
app.use(express.json());

// Anti-cache header agar browser dan client tidak pernah menyajikan data kadaluarsa
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ===================================================
// SUPABASE POSTGRESQL & LOCAL JSON HYBRID STORAGE
// ===================================================
// Helper format tanggal lokal (YYYY-MM-DD) bebas perbedaan timezone UTC vs WIB
function getLocalDateStr(date) {
  const d = date ? (date instanceof Date ? date : new Date(date)) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
}

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const defaultData = {
  users: [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
    { id: 2, username: 'investor', password: 'investor123', role: 'investor' },
    { id: 3, username: 'supir', password: 'supir123', role: 'supir' }
  ],
  dataMobil: [],
  dataTransaksi: [],
  riwayatBulanan: []
};

function loadLocalDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
      return defaultData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || defaultData.users,
      dataMobil: parsed.dataMobil || defaultData.dataMobil,
      dataTransaksi: parsed.dataTransaksi || defaultData.dataTransaksi,
      riwayatBulanan: parsed.riwayatBulanan || []
    };
  } catch (err) {
    return defaultData;
  }
}

let localDB = loadLocalDatabase();

function saveLocalDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(localDB, null, 2), 'utf-8');
  } catch (err) {
    console.error('Gagal menyimpan ke database.json:', err);
  }
}

// Inisialisasi Pool Supabase dengan otomatisasi koneksi pooler IPv4
let pool = null;
let rawConnStr = process.env.DATABASE_URL;

// Validasi Environment (Mencegah Connection Bleed)
const appName = process.env.APP_NAME;
if (!appName) {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('CRITICAL ERROR: Variabel APP_NAME belum diset di Vercel!');
  console.error('Silakan set APP_NAME=JRC (untuk JRC Trans) atau APP_NAME=JRC (untuk JRC Trans)');
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  process.exit(1);
}

if (rawConnStr) {
  try {
    pool = new Pool({
      connectionString: rawConnStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10
    });
    console.log('✓ Inisialisasi Pool Supabase selesai');
    // Jalankan schema sync di background
    ensureDatabaseSchema(pool).catch(err => {
      console.error('Peringatan saat inisialisasi skema Supabase:', err.message);
    });
  } catch (err) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error(`CRITICAL ERROR: Inisialisasi pool PostgreSQL gagal (${err.message}).`);
    console.error('Jika deploy di Vercel, data akan HILANG saat server restart!');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    pool = null;
  }
} else {
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error('CRITICAL ERROR: DATABASE_URL tidak diset di Environment Variables!');
  console.error('Jika deploy di Vercel, data akan HILANG saat server restart.');
  console.error('Harap set DATABASE_URL di dashboard Vercel Anda.');
  console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log('Menggunakan penyimpanan lokal database.json sebagai fallback sementara.');
}

// Memastikan skema tabel Supabase lengkap & menyinkronkan data cache dua arah
async function ensureDatabaseSchema(p) {
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'investor',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS data_mobil (
        id SERIAL PRIMARY KEY,
        nama_mobil VARCHAR(100) NOT NULL,
        plat_nomor VARCHAR(30) UNIQUE NOT NULL,
        tahun INT DEFAULT 2025,
        kepemilikan VARCHAR(20) NOT NULL DEFAULT 'investor',
        status_sewa VARCHAR(20) DEFAULT 'Tersedia',
        tgl_kembali VARCHAR(30) DEFAULT '-',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS data_transaksi (
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
      CREATE TABLE IF NOT EXISTS riwayat_bulanan (
        id SERIAL PRIMARY KEY,
        periode VARCHAR(7) UNIQUE NOT NULL,
        nama_bulan VARCHAR(30) NOT NULL,
        tahun INT NOT NULL,
        total_transaksi INT DEFAULT 0,
        total_pendapatan NUMERIC DEFAULT 0,
        total_biaya NUMERIC DEFAULT 0,
        total_keuntungan_bersih NUMERIC DEFAULT 0,
        total_porsi_pengelola NUMERIC DEFAULT 0,
        total_porsi_investor NUMERIC DEFAULT 0,
        rincian_biaya JSONB DEFAULT '{}',
        rincian_unit JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'closed',
        closed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        closed_by VARCHAR(50) DEFAULT 'SYSTEM_AUTO'
      );
    `);

    // Jika data_mobil di Supabase kosong, masukkan data armada awal dari database.json
    const countRes = await p.query('SELECT COUNT(*) FROM data_mobil');
    const mobilCount = parseInt(countRes.rows[0].count, 10);
    if (mobilCount === 0 && localDB.dataMobil && localDB.dataMobil.length > 0) {
      console.log(`Menyinkronkan ${localDB.dataMobil.length} armada awal ke Supabase...`);
      for (const m of localDB.dataMobil) {
        await p.query(
          'INSERT INTO data_mobil (id, nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (plat_nomor) DO NOTHING',
          [m.id, m.nama_mobil, m.plat_nomor, m.tahun, m.kepemilikan, m.status_sewa || 'Tersedia', m.tgl_kembali || '-']
        );
      }
      await p.query("SELECT setval('data_mobil_id_seq', (SELECT COALESCE(MAX(id), 1) FROM data_mobil))");
    }

    // Sinkronisasi data dari Supabase ke localDB (cache offline agar kedua database selalu 100% identik)
    await syncFromSupabaseToLocal(p);
  } catch (err) {
    console.error('Peringatan saat inisialisasi skema Supabase:', err.message);
  }
}

async function syncFromSupabaseToLocal(p) {
  try {
    const uRes = await p.query('SELECT id, username, password, role FROM users ORDER BY id ASC');
    if (uRes.rows.length > 0) localDB.users = uRes.rows;

    const mRes = await p.query('SELECT id, nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali FROM data_mobil ORDER BY id ASC');
    if (mRes.rows.length > 0) {
      localDB.dataMobil = mRes.rows.map(m => ({ ...m, id: Number(m.id), tahun: Number(m.tahun) || 2025 }));
    }

    const tRes = await p.query('SELECT * FROM data_transaksi ORDER BY tanggal DESC, id DESC');
    if (tRes.rows.length > 0) {
      localDB.dataTransaksi = tRes.rows.map(t => {
        const tglStr = t.tanggal instanceof Date ? getLocalDateStr(t.tanggal) : String(t.tanggal);
        const tglMulaiStr = t.tgl_mulai instanceof Date ? getLocalDateStr(t.tgl_mulai) : (t.tgl_mulai ? String(t.tgl_mulai) : tglStr);
        const tglKembaliStr = t.tgl_kembali instanceof Date ? getLocalDateStr(t.tgl_kembali) : (t.tgl_kembali ? String(t.tgl_kembali) : tglStr);
        return {
          id: Number(t.id),
          mobil_id: Number(t.mobil_id),
          tanggal: tglStr,
          tgl_mulai: tglMulaiStr,
          tgl_kembali: tglKembaliStr,
          penyewa: t.penyewa || '-',
          tarif: Number(t.tarif) || 0,
          tarif_sewa: Number(t.tarif_sewa || t.tarif) || 0,
          biaya_bbm: Number(t.biaya_bbm) || 0,
          biaya_servis: Number(t.biaya_servis) || 0,
          biaya_lainnya: Number(t.biaya_lainnya) || 0,
          keterangan: t.keterangan || '-'
        };
      });
    } else if (localDB.dataTransaksi && localDB.dataTransaksi.length > 0) {
      // Supabase masih kosong, unggah data transaksi lokal ke Supabase
      for (const t of localDB.dataTransaksi) {
        await p.query(
          'INSERT INTO data_transaksi (mobil_id, tanggal, tgl_mulai, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          [t.mobil_id, t.tanggal, t.tgl_mulai || t.tanggal, t.tgl_kembali || t.tanggal, t.penyewa, t.tarif || t.tarif_sewa, t.tarif_sewa || t.tarif, t.biaya_bbm, t.biaya_servis, t.biaya_lainnya, t.keterangan]
        );
      }
      console.log(`✓ Mengunggah ${localDB.dataTransaksi.length} transaksi lokal ke Supabase PostgreSQL.`);
    }

    const rRes = await p.query('SELECT * FROM riwayat_bulanan ORDER BY periode DESC');
    if (rRes.rows.length > 0) {
      localDB.riwayatBulanan = rRes.rows.map(r => ({
        ...r,
        id: Number(r.id),
        tahun: Number(r.tahun),
        total_transaksi: Number(r.total_transaksi),
        total_pendapatan: Number(r.total_pendapatan),
        total_biaya: Number(r.total_biaya),
        total_keuntungan_bersih: Number(r.total_keuntungan_bersih),
        total_porsi_pengelola: Number(r.total_porsi_pengelola),
        total_porsi_investor: Number(r.total_porsi_investor)
      }));
    } else if (localDB.riwayatBulanan && localDB.riwayatBulanan.length > 0) {
      for (const r of localDB.riwayatBulanan) {
        await p.query(
          'INSERT INTO riwayat_bulanan (periode, nama_bulan, tahun, total_transaksi, total_pendapatan, total_biaya, total_keuntungan_bersih, total_porsi_pengelola, total_porsi_investor, rincian_biaya, rincian_unit, status, closed_at, closed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
          [
            r.periode, r.nama_bulan, r.tahun, r.total_transaksi || 0,
            r.total_pendapatan || 0, r.total_biaya || 0, r.total_keuntungan_bersih || 0,
            r.total_porsi_pengelola || 0, r.total_porsi_investor || 0,
            JSON.stringify(r.rincian_biaya || {}), JSON.stringify(r.rincian_unit || r.ringkasan_unit || []),
            r.status || 'closed', r.closed_at || r.created_at || new Date().toISOString(), r.closed_by || 'SYSTEM_AUTO'
          ]
        );
      }
    }

    saveLocalDatabase();
    console.log(`✓ Sinkronisasi cloud berhasil: ${localDB.dataMobil.length} armada, ${localDB.dataTransaksi.length} transaksi, ${localDB.riwayatBulanan.length} arsip.`);
  } catch (err) {
    console.warn('Gagal sinkronisasi data dari Supabase ke lokal:', err.message);
  }
}

// Database Abstraction Layer dengan Dual-Write (Supabase PG + Local JSON selalu sinkron)
const dbService = {
  async getUserByUsername(username) {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
        if (res.rows[0]) return res.rows[0];
      } catch (err) {
        console.warn(`⚠️ Gagal query users ke Supabase (${err.message}), membaca dari database lokal.`);
      }
    }
    return localDB.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()) || null;
  },

  async addUser(user) {
    let pgRow = null;
    if (pool) {
      try {
        const res = await pool.query(
          'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
          [user.username.trim(), user.password.trim(), user.role]
        );
        pgRow = res.rows[0];
      } catch (err) {
        console.warn(`⚠️ Gagal insert user ke Supabase (${err.message}), menyimpan ke database lokal.`);
      }
    }
    const newId = pgRow ? Number(pgRow.id) : (localDB.users.length > 0 ? localDB.users[localDB.users.length - 1].id + 1 : 1);
    const newUser = {
      id: newId,
      username: user.username.trim(),
      password: user.password.trim(),
      role: user.role
    };
    const existIdx = localDB.users.findIndex(u => u.username.toLowerCase() === newUser.username.toLowerCase());
    if (existIdx !== -1) {
      localDB.users[existIdx] = newUser;
    } else {
      localDB.users.push(newUser);
    }
    saveLocalDatabase();
    return newUser;
  },

  async getMobil() {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM data_mobil ORDER BY id ASC');
        const list = res.rows.map(m => ({
          ...m,
          id: Number(m.id),
          tahun: Number(m.tahun) || 2025
        }));
        localDB.dataMobil = list;
        return list;
      } catch (err) {
        console.warn(`⚠️ Gagal query mobil ke Supabase (${err.message}), membaca dari database lokal.`);
      }
    }
    return localDB.dataMobil.map(m => ({
      ...m,
      id: Number(m.id),
      tahun: Number(m.tahun) || 2025
    }));
  },

  async addMobil(m) {
    let pgRow = null;
    if (pool) {
      try {
        const res = await pool.query(
          'INSERT INTO data_mobil (nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [m.nama_mobil, m.plat_nomor, m.tahun, m.kepemilikan, m.status_sewa || 'Tersedia', m.tgl_kembali || '-']
        );
        pgRow = res.rows[0];
      } catch (err) {
        console.warn(`⚠️ Gagal insert mobil ke Supabase (${err.message}), menyimpan ke database lokal.`);
      }
    }
    const maxId = localDB.dataMobil.length > 0 ? Math.max(...localDB.dataMobil.map(mob => Number(mob.id) || 0)) : 0;
    const newId = pgRow ? Number(pgRow.id) : (maxId + 1);
    const newMobil = {
      ...m,
      id: newId,
      tahun: Number(m.tahun) || 2025,
      status_sewa: m.status_sewa || 'Tersedia',
      tgl_kembali: m.tgl_kembali || '-'
    };
    const existIdx = localDB.dataMobil.findIndex(mob => Number(mob.id) === newId);
    if (existIdx !== -1) {
      localDB.dataMobil[existIdx] = newMobil;
    } else {
      localDB.dataMobil.push(newMobil);
    }
    saveLocalDatabase();
    return newMobil;
  },

  async updateMobilStatus(id, status_sewa, tgl_kembali) {
    const numId = Number(id);
    if (pool) {
      try {
        await pool.query(
          'UPDATE data_mobil SET status_sewa = $1, tgl_kembali = $2 WHERE id = $3',
          [status_sewa, tgl_kembali || '-', numId]
        );
      } catch (err) {
        console.warn(`⚠️ Gagal update status mobil ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    const idx = localDB.dataMobil.findIndex(m => Number(m.id) === numId);
    if (idx !== -1) {
      if (status_sewa) localDB.dataMobil[idx].status_sewa = status_sewa;
      if (tgl_kembali !== undefined) localDB.dataMobil[idx].tgl_kembali = tgl_kembali;
      saveLocalDatabase();
      return localDB.dataMobil[idx];
    }
    return null;
  },

  async updateMobil(id, m) {
    const numId = Number(id);
    if (pool) {
      try {
        await pool.query(
          'UPDATE data_mobil SET nama_mobil = $1, plat_nomor = $2, tahun = $3, kepemilikan = $4, status_sewa = COALESCE($5, status_sewa), tgl_kembali = COALESCE($6, tgl_kembali) WHERE id = $7',
          [m.nama_mobil, m.plat_nomor, m.tahun, m.kepemilikan, m.status_sewa, m.tgl_kembali, numId]
        );
      } catch (err) {
        console.warn(`⚠️ Gagal update mobil ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    const idx = localDB.dataMobil.findIndex(mob => Number(mob.id) === numId);
    if (idx !== -1) {
      localDB.dataMobil[idx] = { ...localDB.dataMobil[idx], ...m, id: numId };
      saveLocalDatabase();
      return localDB.dataMobil[idx];
    }
    return null;
  },

  async deleteMobil(id) {
    const numId = Number(id);
    if (pool) {
      try {
        await pool.query('DELETE FROM data_transaksi WHERE mobil_id = $1', [numId]);
        await pool.query('DELETE FROM data_mobil WHERE id = $1', [numId]);
      } catch (err) {
        console.warn(`⚠️ Gagal delete mobil ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    localDB.dataMobil = localDB.dataMobil.filter(m => Number(m.id) !== numId);
    localDB.dataTransaksi = (localDB.dataTransaksi || []).filter(t => Number(t.mobil_id) !== numId);
    saveLocalDatabase();
    return true;
  },

  async getTransaksi() {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM data_transaksi ORDER BY tanggal DESC, id DESC');
        const list = res.rows.map(t => {
          const tglStr = t.tanggal instanceof Date ? getLocalDateStr(t.tanggal) : String(t.tanggal);
          const tglMulaiStr = t.tgl_mulai instanceof Date ? getLocalDateStr(t.tgl_mulai) : (t.tgl_mulai ? String(t.tgl_mulai) : tglStr);
          const tglKembaliStr = t.tgl_kembali instanceof Date ? getLocalDateStr(t.tgl_kembali) : (t.tgl_kembali ? String(t.tgl_kembali) : tglStr);
          return {
            id: Number(t.id),
            mobil_id: Number(t.mobil_id),
            tanggal: tglStr,
            tgl_mulai: tglMulaiStr,
            tgl_kembali: tglKembaliStr,
            penyewa: t.penyewa || '-',
            tarif: Number(t.tarif) || 0,
            tarif_sewa: Number(t.tarif_sewa || t.tarif) || 0,
            biaya_bbm: Number(t.biaya_bbm) || 0,
            biaya_servis: Number(t.biaya_servis) || 0,
            biaya_lainnya: Number(t.biaya_lainnya) || 0,
            keterangan: t.keterangan || '-'
          };
        });
        localDB.dataTransaksi = list;
        return list;
      } catch (err) {
        console.warn(`⚠️ Gagal query transaksi ke Supabase (${err.message}), membaca dari database lokal.`);
      }
    }
    return [...localDB.dataTransaksi]
      .map(t => ({
        ...t,
        id: Number(t.id),
        mobil_id: Number(t.mobil_id),
        tarif: Number(t.tarif) || 0,
        tarif_sewa: Number(t.tarif_sewa || t.tarif) || 0,
        biaya_bbm: Number(t.biaya_bbm) || 0,
        biaya_servis: Number(t.biaya_servis) || 0,
        biaya_lainnya: Number(t.biaya_lainnya) || 0
      }))
      .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || (b.id - a.id));
  },

  async addTransaksi(t) {
    let pgRow = null;
    if (pool) {
      try {
        const res = await pool.query(
          'INSERT INTO data_transaksi (mobil_id, tanggal, tgl_mulai, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [t.mobil_id, t.tanggal, t.tgl_mulai, t.tgl_kembali, t.penyewa, t.tarif, t.tarif_sewa, t.biaya_bbm, t.biaya_servis, t.biaya_lainnya, t.keterangan]
        );
        pgRow = res.rows[0];
      } catch (err) {
        console.warn(`⚠️ Gagal insert transaksi ke Supabase (${err.message}), menyimpan ke database lokal.`);
      }
    }
    const maxId = localDB.dataTransaksi.length > 0 ? Math.max(...localDB.dataTransaksi.map(tx => Number(tx.id) || 0)) : 0;
    const newId = pgRow ? Number(pgRow.id) : (maxId + 1);
    const newTx = {
      ...t,
      id: newId,
      mobil_id: Number(t.mobil_id),
      tarif: Number(t.tarif) || 0,
      tarif_sewa: Number(t.tarif_sewa || t.tarif) || 0,
      biaya_bbm: Number(t.biaya_bbm) || 0,
      biaya_servis: Number(t.biaya_servis) || 0,
      biaya_lainnya: Number(t.biaya_lainnya) || 0
    };
    const existIdx = localDB.dataTransaksi.findIndex(tx => Number(tx.id) === newId);
    if (existIdx !== -1) {
      localDB.dataTransaksi[existIdx] = newTx;
    } else {
      localDB.dataTransaksi.push(newTx);
    }
    saveLocalDatabase();
    return newTx;
  },

  async updateTransaksi(id, t) {
    const numId = Number(id);
    if (pool) {
      try {
        await pool.query(
          'UPDATE data_transaksi SET mobil_id = $1, tanggal = $2, tgl_mulai = $3, tgl_kembali = $4, penyewa = $5, tarif = $6, tarif_sewa = $7, biaya_bbm = $8, biaya_servis = $9, biaya_lainnya = $10, keterangan = $11 WHERE id = $12',
          [t.mobil_id, t.tanggal, t.tgl_mulai, t.tgl_kembali, t.penyewa, t.tarif, t.tarif_sewa, t.biaya_bbm, t.biaya_servis, t.biaya_lainnya, t.keterangan, numId]
        );
      } catch (err) {
        console.warn(`⚠️ Gagal update transaksi ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    const idx = localDB.dataTransaksi.findIndex(tx => Number(tx.id) === numId);
    if (idx !== -1) {
      localDB.dataTransaksi[idx] = {
        ...localDB.dataTransaksi[idx],
        ...t,
        id: numId,
        mobil_id: Number(t.mobil_id !== undefined ? t.mobil_id : localDB.dataTransaksi[idx].mobil_id)
      };
      saveLocalDatabase();
      return localDB.dataTransaksi[idx];
    }
    return null;
  },

  async deleteTransaksi(id) {
    const numId = Number(id);
    if (pool) {
      try {
        await pool.query('DELETE FROM data_transaksi WHERE id = $1', [numId]);
      } catch (err) {
        console.warn(`⚠️ Gagal delete transaksi ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    localDB.dataTransaksi = localDB.dataTransaksi.filter(t => Number(t.id) !== numId);
    saveLocalDatabase();
    return true;
  },

  async getRiwayatBulanan() {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM riwayat_bulanan ORDER BY periode DESC');
        const list = res.rows.map(r => ({
          ...r,
          id: Number(r.id),
          tahun: Number(r.tahun),
          total_transaksi: Number(r.total_transaksi),
          total_pendapatan: Number(r.total_pendapatan),
          total_biaya: Number(r.total_biaya),
          total_keuntungan_bersih: Number(r.total_keuntungan_bersih),
          total_porsi_pengelola: Number(r.total_porsi_pengelola),
          total_porsi_investor: Number(r.total_porsi_investor)
        }));
        localDB.riwayatBulanan = list;
        return list;
      } catch (err) {
        console.warn(`⚠️ Gagal query riwayat_bulanan ke Supabase (${err.message}), membaca dari database lokal.`);
      }
    }
    if (!localDB.riwayatBulanan) localDB.riwayatBulanan = [];
    return [...localDB.riwayatBulanan].sort((a, b) => b.periode.localeCompare(a.periode));
  },

  async getRiwayatBulananByPeriode(periode) {
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM riwayat_bulanan WHERE periode = $1', [periode]);
        if (res.rows.length > 0) {
          const r = res.rows[0];
          return {
            ...r,
            id: Number(r.id),
            tahun: Number(r.tahun),
            total_transaksi: Number(r.total_transaksi),
            total_pendapatan: Number(r.total_pendapatan),
            total_biaya: Number(r.total_biaya),
            total_keuntungan_bersih: Number(r.total_keuntungan_bersih),
            total_porsi_pengelola: Number(r.total_porsi_pengelola),
            total_porsi_investor: Number(r.total_porsi_investor)
          };
        }
        return null;
      } catch (err) {
        console.warn(`⚠️ Gagal query riwayat_bulanan by periode ke Supabase (${err.message}), membaca dari database lokal.`);
      }
    }
    if (!localDB.riwayatBulanan) localDB.riwayatBulanan = [];
    return localDB.riwayatBulanan.find(r => r.periode === periode) || null;
  },

  async addRiwayatBulanan(item) {
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO riwayat_bulanan (
            periode, nama_bulan, tahun, total_transaksi, total_pendapatan, total_biaya,
            total_keuntungan_bersih, total_porsi_pengelola, total_porsi_investor,
            rincian_biaya, rincian_unit, status, closed_at, closed_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (periode) DO UPDATE SET
            total_transaksi = EXCLUDED.total_transaksi,
            total_pendapatan = EXCLUDED.total_pendapatan,
            total_biaya = EXCLUDED.total_biaya,
            total_keuntungan_bersih = EXCLUDED.total_keuntungan_bersih,
            total_porsi_pengelola = EXCLUDED.total_porsi_pengelola,
            total_porsi_investor = EXCLUDED.total_porsi_investor,
            rincian_biaya = EXCLUDED.rincian_biaya,
            rincian_unit = EXCLUDED.rincian_unit,
            status = EXCLUDED.status,
            closed_at = EXCLUDED.closed_at,
            closed_by = EXCLUDED.closed_by`,
          [
            item.periode, item.nama_bulan, item.tahun, item.total_transaksi || 0,
            item.total_pendapatan || 0, item.total_biaya || 0, item.total_keuntungan_bersih || 0,
            item.total_porsi_pengelola || 0, item.total_porsi_investor || 0,
            JSON.stringify(item.rincian_biaya || {}), JSON.stringify(item.rincian_unit || []),
            item.status || 'closed', item.closed_at || new Date().toISOString(), item.closed_by || 'SYSTEM_AUTO'
          ]
        );
      } catch (err) {
        console.warn(`⚠️ Gagal insert riwayat_bulanan ke Supabase (${err.message}), beralih ke database lokal.`);
      }
    }
    if (!localDB.riwayatBulanan) localDB.riwayatBulanan = [];
    const existingIdx = localDB.riwayatBulanan.findIndex(r => r.periode === item.periode);
    const newRecord = {
      id: existingIdx !== -1 ? localDB.riwayatBulanan[existingIdx].id : (localDB.riwayatBulanan.length > 0 ? Math.max(...localDB.riwayatBulanan.map(r => r.id || 0)) + 1 : 1),
      ...item,
      closed_at: item.closed_at || new Date().toISOString(),
      closed_by: item.closed_by || 'SYSTEM_AUTO'
    };
    if (existingIdx !== -1) {
      localDB.riwayatBulanan[existingIdx] = newRecord;
    } else {
      localDB.riwayatBulanan.push(newRecord);
    }
    saveLocalDatabase();
    return newRecord;
  }
};

const NAMA_BULAN_INDO = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

// Logika Keamanan Data & Auto-Archiving Idempoten
async function checkAndAutoArchiveMonthly(forcedDate = null) {
  try {
    const todayStr = forcedDate ? getLocalDateStr(new Date(forcedDate)) : getLocalDateStr();
    const currentYearMonth = todayStr.substring(0, 7); // 'YYYY-MM'

    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const existingArchives = await dbService.getRiwayatBulanan();
    const archivedPeriodSet = new Set(existingArchives.map(a => a.periode));

    // Kumpulkan semua periode transaksi lampau (< currentYearMonth)
    const pastMonthsSet = new Set();
    allTx.forEach(t => {
      if (t.tanggal && typeof t.tanggal === 'string' && t.tanggal.length >= 7) {
        const ym = t.tanggal.substring(0, 7);
        if (ym < currentYearMonth) {
          pastMonthsSet.add(ym);
        }
      }
    });

    const pastMonths = Array.from(pastMonthsSet).sort();

    for (const ym of pastMonths) {
      // Keamanan Idempotensi: Lewati jika bulan ini sudah pernah diarsipkan
      if (archivedPeriodSet.has(ym)) continue;

      const [tahunStr, bulanStr] = ym.split('-');
      const tahunNum = parseInt(tahunStr, 10);
      const bulanNum = parseInt(bulanStr, 10);
      const namaBulan = NAMA_BULAN_INDO[bulanNum - 1] || `Bulan ${bulanNum}`;

      const txBulan = allTx.filter(t => t.tanggal && t.tanggal.startsWith(ym));
      let total_pendapatan = 0;
      let total_bbm = 0;
      let total_servis = 0;
      let total_lainnya = 0;
      let total_porsi_pengelola = 0;
      let total_porsi_investor = 0;

      const rincian_unit = allMobil.map(m => {
        const txUnit = txBulan.filter(t => Number(t.mobil_id) === Number(m.id));
        const pend = txUnit.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
        const bbm = txUnit.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
        const srv = txUnit.reduce((s, t) => s + (t.biaya_servis || 0), 0);
        const lnn = txUnit.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
        const totalBia = bbm + srv + lnn;
        const labaBersih = pend - totalBia;

        const isInv = m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor');
        const pPengelola = isInv ? Math.round(pend * 0.30) : labaBersih;
        const pInvestor = isInv ? (Math.round(pend * 0.70) - totalBia) : 0;

        total_pendapatan += pend;
        total_bbm += bbm;
        total_servis += srv;
        total_lainnya += lnn;
        total_porsi_pengelola += pPengelola;
        total_porsi_investor += pInvestor;

        return {
          mobil_id: m.id,
          nama_mobil: m.nama_mobil,
          plat_nomor: m.plat_nomor,
          kepemilikan: isInv ? 'Investor' : 'JRC Trans',
          total_transaksi: txUnit.length,
          total_pendapatan: pend,
          total_biaya: totalBia,
          laba_bersih: labaBersih,
          porsi_pengelola: pPengelola,
          porsi_investor: pInvestor
        };
      });

      const total_biaya = total_bbm + total_servis + total_lainnya;
      const total_keuntungan_bersih = total_pendapatan - total_biaya;

      const archiveRecord = {
        periode: ym,
        nama_bulan: namaBulan,
        tahun: tahunNum,
        total_transaksi: txBulan.length,
        total_pendapatan,
        total_biaya,
        total_keuntungan_bersih,
        total_porsi_pengelola,
        total_porsi_investor,
        rincian_biaya: {
          bbm: total_bbm,
          servis: total_servis,
          lainnya: total_lainnya
        },
        rincian_unit,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: 'SYSTEM_AUTO'
      };

      await dbService.addRiwayatBulanan(archiveRecord);
      archivedPeriodSet.add(ym);
      console.log(`[MONTHLY ARCHIVE] ✅ Berhasil mengarsipkan siklus ${namaBulan} ${tahunNum} (${ym}): Omset Rp ${total_pendapatan.toLocaleString('id-ID')}, Biaya Rp ${total_biaya.toLocaleString('id-ID')}, Keuntungan Rp ${total_keuntungan_bersih.toLocaleString('id-ID')}`);
    }
  } catch (err) {
    console.error('[MONTHLY ARCHIVE ERROR]:', err);
  }
}

// ===================================================
// MIDDLEWARE AUTHENTICATION & RBAC
// ===================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Akses ditolak, token tidak ditemukan' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Sesi Anda telah kedaluwarsa, silakan login kembali.',
          code: 'TOKEN_EXPIRED',
          expired: true
        });
      }
      return res.status(403).json({
        error: 'Token tidak valid, silakan login kembali.',
        code: 'TOKEN_INVALID',
        invalid: true
      });
    }
    req.user = user;
    next();
  });
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Akses ditolak. Fitur ini hanya untuk role: ${allowedRoles.join(', ')}` });
    }
    next();
  };
}

// Helper filter tanggal transaksi
function filterTxByPeriod(txList, filterType, startDate, endDate) {
  if (!filterType || filterType === 'all') return txList;

  const todayStr = getLocalDateStr();
  const now = new Date();

  if (filterType === 'hari_ini') {
    return txList.filter(t => t.tanggal === todayStr);
  }

  if (filterType === '7_hari') {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const startStr = getLocalDateStr(sevenDaysAgo);
    return txList.filter(t => t.tanggal >= startStr && t.tanggal <= todayStr);
  }

  if (filterType === 'bulan_ini') {
    const yearMonth = todayStr.substring(0, 7); // 'YYYY-MM'
    return txList.filter(t => t.tanggal && t.tanggal.startsWith(yearMonth));
  }

  if (filterType.startsWith('archive:') || filterType.startsWith('bulan:')) {
    const targetMonth = filterType.replace(/^(archive:|bulan:)/, '').trim();
    return txList.filter(t => t.tanggal && t.tanggal.startsWith(targetMonth));
  }

  if (filterType === 'custom') {
    if (!startDate || !endDate) return txList;
    return txList.filter(t => t.tanggal >= startDate && t.tanggal <= endDate);
  }

  return txList;
}

// ===================================================
// 1. AUTHENTICATION & USERS
// ===================================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan Password wajib diisi!' });

  try {
    const foundUser = await dbService.getUserByUsername(username);
    if (foundUser && foundUser.password === password) {
      // Jalankan pengecekan auto-archive asinkron saat login berhasil
      checkAndAutoArchiveMonthly().catch(e => console.error('[LOGIN ARCHIVE CHECK ERROR]', e));
      const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
      const token = jwt.sign({ username: foundUser.username, role: foundUser.role }, SECRET_KEY, { expiresIn });
      return res.json({ token, username: foundUser.username, role: foundUser.role, expiresIn });
    }
    return res.status(400).json({ error: 'Username atau Password salah!' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server database' });
  }
});

// Verifikasi token aktif
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Endpoint Tambah User Baru (Khusus Admin)
app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, dan role wajib diisi!' });
  }

  try {
    const existing = await dbService.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username sudah digunakan!' });
    }

    const roleClean = role.toLowerCase().trim();
    let assignedRole = 'supir';
    if (roleClean === 'admin') assignedRole = 'admin';
    else if (roleClean === 'investor') assignedRole = 'investor';
    else if (roleClean === 'supir') assignedRole = 'supir';

    const newUser = await dbService.addUser({ username, password, role: assignedRole });
    res.json({ message: 'User baru berhasil dibuat!', user: { id: newUser.id, username: newUser.username, role: newUser.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal membuat user baru' });
  }
});

// ===================================================
// HELPER AUTO-AVAILABILITY REALTIME
// ===================================================
function resolveMobilStatus(m, transaksiList) {
  const stLower = (m.status_sewa || '').toLowerCase();
  if (stLower === 'maintenance' || stLower === 'servis') {
    return {
      status_sewa: 'Maintenance',
      tgl_kembali: m.tgl_kembali || '-'
    };
  }

  const today = getLocalDateStr();

  const activeTx = (transaksiList || [])
    .filter(t => Number(t.mobil_id) === Number(m.id))
    .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
    .find(t => {
      const start = t.tanggal || t.tgl_mulai || '';
      const end = t.tgl_kembali || t.tanggal || '';
      return start <= today && today <= end;
    });

  if (activeTx) {
    return {
      status_sewa: 'Disewa',
      tgl_kembali: activeTx.tgl_kembali || activeTx.tanggal || '-'
    };
  }

  return {
    status_sewa: 'Tersedia',
    tgl_kembali: '-'
  };
}

// ===================================================
// 2. ARMADA (CRUD Lengkap)
// ===================================================
app.get('/api/mobil', authenticateToken, async (req, res) => {
  try {
    const mobilList = await dbService.getMobil();
    const txList = await dbService.getTransaksi();

    const result = mobilList.map(m => {
      const dynamicStatus = resolveMobilStatus(m, txList);
      if (m.status_sewa !== dynamicStatus.status_sewa || m.tgl_kembali !== dynamicStatus.tgl_kembali) {
        dbService.updateMobilStatus(m.id, dynamicStatus.status_sewa, dynamicStatus.tgl_kembali).catch(() => { });
      }
      return {
        ...m,
        status_sewa: dynamicStatus.status_sewa,
        tgl_kembali: dynamicStatus.tgl_kembali
      };
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data armada' });
  }
});

app.post('/api/mobil', authenticateToken, requireRole('admin'), async (req, res) => {
  const { nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali } = req.body;
  if (!nama_mobil || !plat_nomor) {
    return res.status(400).json({ error: 'Nama mobil dan plat nomor wajib diisi!' });
  }

  const isInvestor = kepemilikan && kepemilikan.toLowerCase().includes('investor');

  try {
    const newMobil = await dbService.addMobil({
      nama_mobil: nama_mobil.trim(),
      plat_nomor: plat_nomor.trim().toUpperCase(),
      tahun: parseInt(tahun) || new Date().getFullYear(),
      kepemilikan: isInvestor ? 'investor' : 'sendiri',
      status_sewa: status_sewa ? (status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1)) : 'Tersedia',
      tgl_kembali: tgl_kembali || '-'
    });
    res.json({ message: 'Armada mobil berhasil ditambahkan!', data: newMobil });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menambahkan armada mobil' });
  }
});

// Edit status mobil cepat (Admin only)
app.put('/api/mobil/:id/status', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { status_sewa, tgl_kembali } = req.body;

  let normStatus = status_sewa;
  if (status_sewa) {
    const sLower = status_sewa.toLowerCase();
    if (sLower === 'sewa' || sLower === 'disewa') normStatus = 'Disewa';
    else if (sLower === 'maintenance' || sLower === 'servis') normStatus = 'Maintenance';
    else normStatus = 'Tersedia';
  }
  const cleanTgl = (normStatus === 'Tersedia') ? '-' : (tgl_kembali || '-');

  try {
    const updated = await dbService.updateMobilStatus(
      id,
      normStatus,
      cleanTgl
    );
    if (!updated) return res.status(404).json({ error: 'Armada tidak ditemukan!' });
    res.json({ message: 'Status armada berhasil diperbarui!', data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memperbarui status armada' });
  }
});

// Edit lengkap armada (Admin only)
app.put('/api/mobil/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali } = req.body;
  const isInvestor = kepemilikan && kepemilikan.toLowerCase().includes('investor');

  try {
    const updated = await dbService.updateMobil(id, {
      nama_mobil: nama_mobil ? nama_mobil.trim() : undefined,
      plat_nomor: plat_nomor ? plat_nomor.trim().toUpperCase() : undefined,
      tahun: parseInt(tahun) || undefined,
      kepemilikan: isInvestor ? 'investor' : 'sendiri',
      status_sewa: status_sewa ? (status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1)) : undefined,
      tgl_kembali: tgl_kembali !== undefined ? tgl_kembali : undefined
    });
    if (!updated) return res.status(404).json({ error: 'Armada tidak ditemukan!' });
    res.json({ message: 'Data armada berhasil diperbarui!', data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memperbarui data armada' });
  }
});

// Hapus armada (Admin only)
app.delete('/api/mobil/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await dbService.deleteMobil(id);
    res.json({ message: 'Armada berhasil dihapus!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menghapus armada' });
  }
});

// ===================================================
// 3. TRANSAKSI (CRUD Lengkap - Khusus Admin)
// ===================================================
app.get('/api/transaksi', authenticateToken, async (req, res) => {
  try {
    await checkAndAutoArchiveMonthly();
    const { filter, start, end } = req.query;
    const txList = await dbService.getTransaksi();
    const mobilList = await dbService.getMobil();

    // Jika filter disertakan (contoh: 'bulan_ini', 'archive:2026-08', 'all', dll.)
    const filteredTx = filter ? filterTxByPeriod(txList, filter, start, end) : txList;

    const result = filteredTx.map(t => {
      const mobil = mobilList.find(m => Number(m.id) === Number(t.mobil_id)) || {};
      return {
        ...t,
        tarif_sewa: t.tarif_sewa || t.tarif || 0,
        nama_mobil: mobil.nama_mobil || '-',
        plat_nomor: mobil.plat_nomor || '-'
      };
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data transaksi' });
  }
});

app.post('/api/transaksi', authenticateToken, requireRole('admin'), async (req, res) => {
  const { mobil_id, tanggal, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan } = req.body;
  if (!mobil_id || isNaN(parseInt(mobil_id))) {
    return res.status(400).json({ error: 'Armada mobil wajib dipilih!' });
  }
  const numMobilId = parseInt(mobil_id);
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;
  const tglMulai = tanggal || getLocalDateStr();
  const tglSelesai = tgl_kembali || tglMulai;

  try {
    const newTx = await dbService.addTransaksi({
      mobil_id: numMobilId,
      tanggal: tglMulai,
      tgl_mulai: tglMulai,
      tgl_kembali: tglSelesai,
      penyewa: penyewa ? penyewa.trim() : '-',
      tarif: tarifNilai,
      tarif_sewa: tarifNilai,
      biaya_bbm: parseFloat(biaya_bbm) || 0,
      biaya_servis: parseFloat(biaya_servis) || 0,
      biaya_lainnya: parseFloat(biaya_lainnya) || 0,
      keterangan: keterangan ? keterangan.trim() : '-'
    });

    // Jika sewa aktif hari ini, update status armada menjadi Disewa secara otomatis
    const today = getLocalDateStr();
    if (tglMulai <= today && today <= tglSelesai) {
      await dbService.updateMobilStatus(numMobilId, 'Disewa', tglSelesai);
    }

    res.json({ message: 'Transaksi berhasil disimpan!', data: newTx });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan transaksi' });
  }
});

// Update transaksi (Admin only)
app.put('/api/transaksi/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { mobil_id, tanggal, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan } = req.body;
  if (!mobil_id || isNaN(parseInt(mobil_id))) {
    return res.status(400).json({ error: 'Armada mobil wajib dipilih!' });
  }
  const numMobilId = parseInt(mobil_id);
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;
  const tglMulai = tanggal || getLocalDateStr();
  const tglSelesai = tgl_kembali || tglMulai;

  try {
    const allTxBefore = await dbService.getTransaksi();
    const oldTx = allTxBefore.find(t => Number(t.id) === id);
    const oldMobilId = oldTx ? Number(oldTx.mobil_id) : null;

    const updated = await dbService.updateTransaksi(id, {
      mobil_id: numMobilId,
      tanggal: tglMulai,
      tgl_mulai: tglMulai,
      tgl_kembali: tglSelesai,
      penyewa: penyewa ? penyewa.trim() : undefined,
      tarif: tarifNilai,
      tarif_sewa: tarifNilai,
      biaya_bbm: parseFloat(biaya_bbm) || 0,
      biaya_servis: parseFloat(biaya_servis) || 0,
      biaya_lainnya: parseFloat(biaya_lainnya) || 0,
      keterangan: keterangan !== undefined ? keterangan.trim() : undefined
    });
    if (!updated) return res.status(404).json({ error: 'Transaksi tidak ditemukan!' });

    // Refresh status kedua armada yang terdampak (mobil lama dan mobil baru)
    const remainingTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const affectedIds = new Set([numMobilId]);
    if (oldMobilId) affectedIds.add(oldMobilId);

    for (const mid of affectedIds) {
      const targetMobil = allMobil.find(m => Number(m.id) === mid);
      if (targetMobil) {
        const resolved = resolveMobilStatus(targetMobil, remainingTx);
        await dbService.updateMobilStatus(targetMobil.id, resolved.status_sewa, resolved.tgl_kembali);
      }
    }

    res.json({ message: 'Transaksi berhasil diperbarui!', data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memperbarui transaksi' });
  }
});

// Hapus transaksi (Admin only)
app.delete('/api/transaksi/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const allTx = await dbService.getTransaksi();
    const targetTx = allTx.find(t => Number(t.id) === id);

    await dbService.deleteTransaksi(id);

    // Jika transaksi yang dihapus terkait mobil tertentu, refresh status ketersediaan armada
    if (targetTx && targetTx.mobil_id) {
      const remainingTx = await dbService.getTransaksi();
      const allMobil = await dbService.getMobil();
      const targetMobil = allMobil.find(m => Number(m.id) === Number(targetTx.mobil_id));
      if (targetMobil) {
        const resolved = resolveMobilStatus(targetMobil, remainingTx);
        await dbService.updateMobilStatus(targetMobil.id, resolved.status_sewa, resolved.tgl_kembali);
      }
    }

    res.json({ message: 'Transaksi berhasil dihapus!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menghapus transaksi' });
  }
});

// ===================================================
// 4. LAPORAN & DASHBOARD
// ===================================================
app.get('/api/laporan/dashboard', authenticateToken, async (req, res) => {
  try {
    // Jalankan auto-archive secara idempoten jika ada pergantian bulan
    await checkAndAutoArchiveMonthly();

    const { filter, start, end } = req.query;
    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const effectiveFilter = filter || 'bulan_ini';

    const isArchiveFilter = effectiveFilter.startsWith('archive:') || effectiveFilter.startsWith('bulan:');
    const targetArchivePeriode = isArchiveFilter ? effectiveFilter.replace(/^(archive:|bulan:)/, '').trim() : null;

    const filteredTx = filterTxByPeriod(allTx, effectiveFilter, start, end);
    const total_mobil = allMobil.length;

    // Cek snapshot arsip di riwayat_bulanan jika permintaan berupa review bulan arsip
    let archivedSnapshot = null;
    if (targetArchivePeriode) {
      archivedSnapshot = await dbService.getRiwayatBulananByPeriode(targetArchivePeriode);
    }

    let total_pendapatan = 0;
    let total_biaya = 0;

    const detailMobil = allMobil.map(m => {
      const txMobil = filteredTx.filter(t => Number(t.mobil_id) === Number(m.id));
      const pend = txMobil.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = txMobil.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = txMobil.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = txMobil.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      total_pendapatan += pend;
      total_biaya += bia;

      const isInv = m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor');
      const porsi_pengelola = isInv ? Math.round(pend * 0.30) : laba_bersih;
      const porsi_investor = isInv ? (Math.round(pend * 0.70) - bia) : 0;

      const dynamicStatus = resolveMobilStatus(m, allTx);

      return {
        id: m.id,
        nama_mobil: m.nama_mobil,
        plat_nomor: m.plat_nomor,
        kepemilikan: isInv ? 'Investor' : 'JRC Trans',
        status_sewa: dynamicStatus.status_sewa,
        tgl_kembali: dynamicStatus.tgl_kembali,
        total_pendapatan: pend,
        biaya_bbm: bbm,
        biaya_servis: servis,
        biaya_lainnya: lainnya,
        total_biaya: bia,
        laba_bersih,
        porsi_pengelola,
        porsi_investor
      };
    });

    // Jika snapshot arsip resmi ditemukan, gunakan ringkasan tersimpan yang telah dibekukan
    if (archivedSnapshot) {
      total_pendapatan = Number(archivedSnapshot.total_pendapatan);
      total_biaya = Number(archivedSnapshot.total_biaya);
    }

    const total_porsi_pengelola = archivedSnapshot && archivedSnapshot.total_porsi_pengelola !== undefined
      ? Number(archivedSnapshot.total_porsi_pengelola)
      : detailMobil.reduce((s, d) => s + (d.porsi_pengelola || 0), 0);

    const total_porsi_investor = archivedSnapshot && archivedSnapshot.total_porsi_investor !== undefined
      ? Number(archivedSnapshot.total_porsi_investor)
      : detailMobil.reduce((s, d) => s + (d.porsi_investor || 0), 0);

    const trendMap = {};
    filteredTx.forEach(t => {
      const tgl = t.tanggal || 'Unknown';
      if (!trendMap[tgl]) {
        trendMap[tgl] = { tanggal: tgl, pendapatan: 0, biaya: 0 };
      }
      trendMap[tgl].pendapatan += (t.tarif || t.tarif_sewa || 0);
      trendMap[tgl].biaya += ((t.biaya_bbm || 0) + (t.biaya_servis || 0) + (t.biaya_lainnya || 0));
    });

    const sortedDates = Object.keys(trendMap).sort();
    const trend_harian = {
      labels: sortedDates.length > 0 ? sortedDates : ['Tidak Ada Transaksi'],
      pendapatan: sortedDates.length > 0 ? sortedDates.map(d => trendMap[d].pendapatan) : [0],
      biaya: sortedDates.length > 0 ? sortedDates.map(d => trendMap[d].biaya) : [0]
    };

    const now = new Date();
    const bulanSekarang = NAMA_BULAN_INDO[now.getMonth()];
    const tahunSekarang = now.getFullYear();

    let labelPeriode = '';
    let isArchived = false;

    if (archivedSnapshot) {
      labelPeriode = `${archivedSnapshot.nama_bulan} ${archivedSnapshot.tahun} (Arsip Tutup Buku)`;
      isArchived = true;
    } else if (effectiveFilter === 'bulan_ini') {
      labelPeriode = `${bulanSekarang} ${tahunSekarang} (Siklus Aktif)`;
    } else if (effectiveFilter === 'hari_ini') {
      labelPeriode = 'Hari Ini';
    } else if (effectiveFilter === '7_hari') {
      labelPeriode = '7 Hari Terakhir';
    } else if (effectiveFilter === 'custom') {
      labelPeriode = `${start} s/d ${end}`;
    } else {
      labelPeriode = 'Semua Waktu (Akumulasi Total)';
    }

    res.json({
      periode: {
        filter: effectiveFilter,
        label: labelPeriode,
        bulan: archivedSnapshot ? archivedSnapshot.nama_bulan : bulanSekarang,
        tahun: archivedSnapshot ? archivedSnapshot.tahun : tahunSekarang,
        is_archived: isArchived,
        archived_info: archivedSnapshot ? {
          periode: archivedSnapshot.periode,
          closed_at: archivedSnapshot.closed_at,
          closed_by: archivedSnapshot.closed_by,
          status: archivedSnapshot.status
        } : null
      },
      summary: {
        total_mobil,
        total_pendapatan,
        total_biaya,
        total_keuntungan_bersih: total_pendapatan - total_biaya,
        total_porsi_pengelola,
        total_porsi_investor,
        is_archived: isArchived
      },
      detail_unit: detailMobil,
      trend_harian
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data dashboard' });
  }
});

// ===================================================
// 5. RIWAYAT ARSIP BULANAN & TUTUP BUKU
// ===================================================
app.get('/api/riwayat-bulanan', authenticateToken, async (req, res) => {
  try {
    await checkAndAutoArchiveMonthly();
    const archives = await dbService.getRiwayatBulanan();
    res.json(archives);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar riwayat bulanan' });
  }
});

app.get('/api/riwayat-bulanan/:periode', authenticateToken, async (req, res) => {
  try {
    const { periode } = req.params;
    const archive = await dbService.getRiwayatBulananByPeriode(periode);
    if (!archive) {
      return res.status(404).json({ error: `Riwayat arsip untuk periode ${periode} tidak ditemukan` });
    }
    res.json(archive);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail riwayat bulanan' });
  }
});

app.post('/api/riwayat-bulanan/tutup-buku', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await checkAndAutoArchiveMonthly();
    const archives = await dbService.getRiwayatBulanan();
    res.json({
      message: 'Proses tutup buku dan arsip bulanan berhasil diverifikasi',
      total_arsip: archives.length,
      archives
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menjalankan proses tutup buku' });
  }
});

// Laporan Investor (Hanya untuk Admin & Investor)
app.get('/api/laporan/investor', authenticateToken, requireRole('admin', 'investor'), async (req, res) => {
  try {
    await checkAndAutoArchiveMonthly();
    const { filter, start, end, mobil_id } = req.query;
    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const filteredTx = filterTxByPeriod(allTx, filter, start, end);

    let mobilInvestor = allMobil.filter(m => m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
    if (mobil_id && mobil_id !== 'all') {
      const targetId = parseInt(mobil_id);
      mobilInvestor = mobilInvestor.filter(m => Number(m.id) === Number(targetId));
    }

    let total_pendapatan = 0;
    let total_biaya = 0;
    let total_bbm_all = 0;
    let total_servis_all = 0;
    let total_lainnya_all = 0;

    const rekapInvestor = [];

    mobilInvestor.forEach(m => {
      const tx = filteredTx
        .filter(t => Number(t.mobil_id) === Number(m.id))
        .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));

      const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = tx.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = tx.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = tx.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      if (tx.length > 0 || (mobil_id && mobil_id !== 'all')) {
        total_pendapatan += pend;
        total_biaya += bia;
        total_bbm_all += bbm;
        total_servis_all += servis;
        total_lainnya_all += lainnya;

        const porsi_pengelola = Math.round(pend * 0.30);
        const hak_investor_kotor_70 = Math.round(pend * 0.70);
        const hak_investor_bersih = hak_investor_kotor_70 - bia;

        rekapInvestor.push({
          id_mobil: m.id,
          nama_mobil: m.nama_mobil,
          plat_nomor: m.plat_nomor,
          tahun: m.tahun,
          kepemilikan: 'Investor',
          total_transaksi: tx.length,
          total_pendapatan: pend,
          biaya_bbm: bbm,
          biaya_servis: servis,
          biaya_lainnya: lainnya,
          total_biaya: bia,
          laba_bersih,
          hak_investor_kotor_70,
          hak_investor_70: hak_investor_bersih,
          porsi_pengelola_30: porsi_pengelola,
          riwayat_transaksi: tx
        });
      }
    });

    res.json({
      periode: { filter: filter || 'all', start: start || '-', end: end || '-' },
      summary: {
        total_pendapatan,
        total_biaya,
        total_bbm: total_bbm_all,
        total_servis: total_servis_all,
        total_lainnya: total_lainnya_all,
        laba_bersih: total_pendapatan - total_biaya,
        total_hak_investor: rekapInvestor.reduce((s, r) => s + r.hak_investor_70, 0),
        total_porsi_pengelola: rekapInvestor.reduce((s, r) => s + r.porsi_pengelola_30, 0)
      },
      detail_unit: rekapInvestor
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil laporan investor' });
  }
});

// ===================================================
// 5. ALL REPORT (LAPORAN KESELURUHAN - KHUSUS ADMIN)
// ===================================================
app.get('/api/laporan/keseluruhan', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await checkAndAutoArchiveMonthly();
    const { filter, start, end, kategori_unit, mobil_id } = req.query;
    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const filteredTx = filterTxByPeriod(allTx, filter, start, end);

    let total_pendapatan = 0;
    let total_biaya = 0;
    let total_bbm_all = 0;
    let total_servis_all = 0;
    let total_lainnya_all = 0;
    let total_porsi_pengelola = 0;
    let total_porsi_investor = 0;

    const detail_unit = [];

    // Filter armada berdasarkan kategori_unit: 'all', 'investor', atau 'sendiri'
    let targetMobil = allMobil.filter(m => {
      const isInv = m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor');
      if (kategori_unit === 'investor') return isInv;
      if (kategori_unit === 'sendiri') return !isInv;
      return true;
    });

    if (mobil_id && mobil_id !== 'all') {
      const targetId = parseInt(mobil_id);
      targetMobil = targetMobil.filter(m => Number(m.id) === Number(targetId));
    }

    targetMobil.forEach(m => {
      const tx = filteredTx
        .filter(t => Number(t.mobil_id) === Number(m.id))
        .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || (a.id - b.id));

      const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = tx.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = tx.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = tx.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      if (tx.length > 0 || (mobil_id && mobil_id !== 'all')) {
        const isInv = m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor');
        const porsi_peng = isInv ? Math.round(pend * 0.30) : laba_bersih;
        const porsi_inv = isInv ? (Math.round(pend * 0.70) - bia) : 0;

        total_pendapatan += pend;
        total_biaya += bia;
        total_bbm_all += bbm;
        total_servis_all += servis;
        total_lainnya_all += lainnya;
        total_porsi_pengelola += porsi_peng;
        total_porsi_investor += porsi_inv;

        const enrichedTx = tx.map(t => {
          const tTarif = Number(t.tarif_sewa !== undefined ? t.tarif_sewa : t.tarif) || 0;
          const tBbm = Number(t.biaya_bbm) || 0;
          const tServis = Number(t.biaya_servis) || 0;
          const tLainnya = Number(t.biaya_lainnya) || 0;
          const tBia = tBbm + tServis + tLainnya;
          const tLaba = tTarif - tBia;
          const tPeng = isInv ? Math.round(tTarif * 0.30) : tLaba;
          const tInv = isInv ? (Math.round(tTarif * 0.70) - tBia) : 0;
          return {
            ...t,
            tarif_sewa: tTarif,
            biaya_bbm: tBbm,
            biaya_servis: tServis,
            biaya_lainnya: tLainnya,
            total_biaya: tBia,
            laba_bersih: tLaba,
            porsi_pengelola: tPeng,
            porsi_investor: tInv
          };
        });

        detail_unit.push({
          id_mobil: m.id,
          nama_mobil: m.nama_mobil,
          plat_nomor: m.plat_nomor,
          tahun: m.tahun,
          kepemilikan: isInv ? 'Investor' : 'JRC Trans (Sendiri)',
          is_investor: isInv,
          total_transaksi: tx.length,
          total_pendapatan: pend,
          biaya_bbm: bbm,
          biaya_servis: servis,
          biaya_lainnya: lainnya,
          total_biaya: bia,
          laba_bersih,
          porsi_pengelola: porsi_peng,
          porsi_investor: porsi_inv,
          riwayat_transaksi: enrichedTx
        });
      }
    });

    const txMobilIds = new Set(targetMobil.map(m => Number(m.id)));
    const countTx = filteredTx.filter(t => txMobilIds.has(Number(t.mobil_id))).length;

    res.json({
      periode: { filter: filter || 'all', start: start || '-', end: end || '-' },
      kategori_unit: kategori_unit || 'all',
      mobil_id: mobil_id || 'all',
      summary: {
        total_transaksi: countTx,
        total_pendapatan,
        total_biaya,
        total_bbm: total_bbm_all,
        total_servis: total_servis_all,
        total_lainnya: total_lainnya_all,
        total_laba_bersih: total_pendapatan - total_biaya,
        total_porsi_pengelola,
        total_porsi_investor
      },
      detail_unit
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil laporan keseluruhan' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server JRC Trans Berjalan di http://localhost:${PORT}`);
    // Jalankan pemeriksaan pengarsipan bulanan otomatis saat server pertama kali start
    checkAndAutoArchiveMonthly().catch(err => console.error('[STARTUP AUTO ARCHIVE ERROR]', err));
  });

  // Cron / Interval berkala: Pengecekan siklus pergantian bulan otomatis setiap 15 menit
  setInterval(() => {
    checkAndAutoArchiveMonthly().catch(err => console.error('[SCHEDULED AUTO ARCHIVE ERROR]', err));
  }, 15 * 60 * 1000);
}

module.exports = app;