require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'secret_key_jrctrans_majalengka';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================================================
// SUPABASE POSTGRESQL & LOCAL JSON HYBRID STORAGE
// ===================================================
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('Menggunakan Supabase PostgreSQL Cloud Database');
} else {
  console.log('DATABASE_URL tidak diset, menggunakan penyimpanan lokal database.json');
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
  dataTransaksi: []
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
      dataTransaksi: parsed.dataTransaksi || defaultData.dataTransaksi
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

// Database Abstraction Layer (Supabase PG / Local JSON)
const dbService = {
  async getUserByUsername(username) {
    if (pool) {
      const res = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
      return res.rows[0] || null;
    }
    return localDB.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()) || null;
  },

  async addUser(user) {
    if (pool) {
      const res = await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
        [user.username.trim(), user.password.trim(), user.role]
      );
      return res.rows[0];
    }
    const newUser = {
      id: localDB.users.length > 0 ? localDB.users[localDB.users.length - 1].id + 1 : 1,
      username: user.username.trim(),
      password: user.password.trim(),
      role: user.role
    };
    localDB.users.push(newUser);
    saveLocalDatabase();
    return newUser;
  },

  async getMobil() {
    if (pool) {
      const res = await pool.query('SELECT * FROM data_mobil ORDER BY id ASC');
      return res.rows.map(m => ({
        ...m,
        tahun: Number(m.tahun) || 2022
      }));
    }
    return localDB.dataMobil;
  },

  async addMobil(m) {
    if (pool) {
      const res = await pool.query(
        'INSERT INTO data_mobil (nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [m.nama_mobil, m.plat_nomor, m.tahun, m.kepemilikan, m.status_sewa || 'Tersedia', m.tgl_kembali || '-']
      );
      return res.rows[0];
    }
    const newMobil = {
      id: localDB.dataMobil.length > 0 ? localDB.dataMobil[localDB.dataMobil.length - 1].id + 1 : 1,
      ...m
    };
    localDB.dataMobil.push(newMobil);
    saveLocalDatabase();
    return newMobil;
  },

  async updateMobilStatus(id, status_sewa, tgl_kembali) {
    if (pool) {
      const res = await pool.query(
        'UPDATE data_mobil SET status_sewa = $1, tgl_kembali = $2 WHERE id = $3 RETURNING *',
        [status_sewa, tgl_kembali || '-', id]
      );
      return res.rows[0];
    }
    const idx = localDB.dataMobil.findIndex(m => m.id === id);
    if (idx !== -1) {
      if (status_sewa) localDB.dataMobil[idx].status_sewa = status_sewa;
      if (tgl_kembali !== undefined) localDB.dataMobil[idx].tgl_kembali = tgl_kembali;
      saveLocalDatabase();
      return localDB.dataMobil[idx];
    }
    return null;
  },

  async updateMobil(id, m) {
    if (pool) {
      const res = await pool.query(
        'UPDATE data_mobil SET nama_mobil = $1, plat_nomor = $2, tahun = $3, kepemilikan = $4, status_sewa = COALESCE($5, status_sewa), tgl_kembali = COALESCE($6, tgl_kembali) WHERE id = $7 RETURNING *',
        [m.nama_mobil, m.plat_nomor, m.tahun, m.kepemilikan, m.status_sewa, m.tgl_kembali, id]
      );
      return res.rows[0];
    }
    const idx = localDB.dataMobil.findIndex(mob => mob.id === id);
    if (idx !== -1) {
      localDB.dataMobil[idx] = { ...localDB.dataMobil[idx], ...m };
      saveLocalDatabase();
      return localDB.dataMobil[idx];
    }
    return null;
  },

  async deleteMobil(id) {
    if (pool) {
      await pool.query('DELETE FROM data_mobil WHERE id = $1', [id]);
      return true;
    }
    localDB.dataMobil = localDB.dataMobil.filter(m => m.id !== id);
    saveLocalDatabase();
    return true;
  },

  async getTransaksi() {
    if (pool) {
      const res = await pool.query('SELECT * FROM data_transaksi ORDER BY tanggal ASC, id ASC');
      return res.rows.map(t => {
        const tglStr = t.tanggal instanceof Date ? t.tanggal.toISOString().split('T')[0] : String(t.tanggal);
        const tglMulaiStr = t.tgl_mulai instanceof Date ? t.tgl_mulai.toISOString().split('T')[0] : (t.tgl_mulai ? String(t.tgl_mulai) : tglStr);
        const tglKembaliStr = t.tgl_kembali instanceof Date ? t.tgl_kembali.toISOString().split('T')[0] : (t.tgl_kembali ? String(t.tgl_kembali) : tglStr);

        return {
          id: t.id,
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
    }
    return localDB.dataTransaksi;
  },

  async addTransaksi(t) {
    if (pool) {
      const res = await pool.query(
        'INSERT INTO data_transaksi (mobil_id, tanggal, tgl_mulai, tgl_kembali, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
        [t.mobil_id, t.tanggal, t.tgl_mulai, t.tgl_kembali, t.penyewa, t.tarif, t.tarif_sewa, t.biaya_bbm, t.biaya_servis, t.biaya_lainnya, t.keterangan]
      );
      const row = res.rows[0];
      return {
        ...row,
        tanggal: row.tanggal instanceof Date ? row.tanggal.toISOString().split('T')[0] : String(row.tanggal)
      };
    }
    const newTx = {
      id: localDB.dataTransaksi.length > 0 ? localDB.dataTransaksi[localDB.dataTransaksi.length - 1].id + 1 : 1,
      ...t
    };
    localDB.dataTransaksi.push(newTx);
    saveLocalDatabase();
    return newTx;
  },

  async updateTransaksi(id, t) {
    if (pool) {
      const res = await pool.query(
        'UPDATE data_transaksi SET mobil_id = $1, tanggal = $2, tgl_mulai = $3, tgl_kembali = $4, penyewa = $5, tarif = $6, tarif_sewa = $7, biaya_bbm = $8, biaya_servis = $9, biaya_lainnya = $10, keterangan = $11 WHERE id = $12 RETURNING *',
        [t.mobil_id, t.tanggal, t.tgl_mulai, t.tgl_kembali, t.penyewa, t.tarif, t.tarif_sewa, t.biaya_bbm, t.biaya_servis, t.biaya_lainnya, t.keterangan, id]
      );
      const row = res.rows[0];
      return {
        ...row,
        tanggal: row.tanggal instanceof Date ? row.tanggal.toISOString().split('T')[0] : String(row.tanggal)
      };
    }
    const idx = localDB.dataTransaksi.findIndex(tx => tx.id === id);
    if (idx !== -1) {
      localDB.dataTransaksi[idx] = { ...localDB.dataTransaksi[idx], ...t };
      saveLocalDatabase();
      return localDB.dataTransaksi[idx];
    }
    return null;
  },

  async deleteTransaksi(id) {
    if (pool) {
      await pool.query('DELETE FROM data_transaksi WHERE id = $1', [id]);
      return true;
    }
    localDB.dataTransaksi = localDB.dataTransaksi.filter(t => t.id !== id);
    saveLocalDatabase();
    return true;
  }
};

// ===================================================
// MIDDLEWARE AUTHENTICATION & RBAC
// ===================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Akses ditolak, token tidak ada' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token tidak valid / expired' });
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

  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();

  if (filterType === 'hari_ini') {
    return txList.filter(t => t.tanggal === todayStr);
  }

  if (filterType === '7_hari') {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const startStr = sevenDaysAgo.toISOString().split('T')[0];
    return txList.filter(t => t.tanggal >= startStr && t.tanggal <= todayStr);
  }

  if (filterType === 'bulan_ini') {
    const yearMonth = todayStr.substring(0, 7); // 'YYYY-MM'
    return txList.filter(t => t.tanggal && t.tanggal.startsWith(yearMonth));
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
      const token = jwt.sign({ username: foundUser.username, role: foundUser.role }, SECRET_KEY, { expiresIn: '1d' });
      return res.json({ token, username: foundUser.username, role: foundUser.role });
    }
    return res.status(400).json({ error: 'Username atau Password salah!' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server database' });
  }
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
  if (m.status_sewa && m.status_sewa.toLowerCase() === 'maintenance') {
    return {
      status_sewa: 'Maintenance',
      tgl_kembali: m.tgl_kembali || '-'
    };
  }

  const today = new Date().toISOString().split('T')[0];

  const activeTx = (transaksiList || [])
    .filter(t => t.mobil_id === m.id)
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

  try {
    const updated = await dbService.updateMobilStatus(
      id,
      status_sewa ? (status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1)) : undefined,
      tgl_kembali
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
    const txList = await dbService.getTransaksi();
    const mobilList = await dbService.getMobil();

    const result = txList.map(t => {
      const mobil = mobilList.find(m => m.id === t.mobil_id) || {};
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
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;
  const tglMulai = tanggal || new Date().toISOString().split('T')[0];
  const tglSelesai = tgl_kembali || tglMulai;

  try {
    const newTx = await dbService.addTransaksi({
      mobil_id: parseInt(mobil_id),
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
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;
  const tglMulai = tanggal || new Date().toISOString().split('T')[0];
  const tglSelesai = tgl_kembali || tglMulai;

  try {
    const updated = await dbService.updateTransaksi(id, {
      mobil_id: parseInt(mobil_id),
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
    await dbService.deleteTransaksi(id);
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
    const { filter, start, end } = req.query;
    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const filteredTx = filterTxByPeriod(allTx, filter, start, end);

    const total_mobil = allMobil.length;
    let total_pendapatan = 0;
    let total_biaya = 0;

    const detailMobil = allMobil.map(m => {
      const txMobil = filteredTx.filter(t => t.mobil_id === m.id);
      const pend = txMobil.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = txMobil.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = txMobil.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = txMobil.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      total_pendapatan += pend;
      total_biaya += bia;

      const isInv = m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor';
      const porsi_pengelola = isInv ? Math.round(pend * 0.30) : laba_bersih;
      const porsi_investor = isInv ? (Math.round(pend * 0.70) - bia) : 0;

      const dynamicStatus = resolveMobilStatus(m, allTx);

      return {
        id: m.id,
        nama_mobil: m.nama_mobil,
        plat_nomor: m.plat_nomor,
        kepemilikan: isInv ? 'Investor' : 'JRCTRANS',
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
      labels: sortedDates.length > 0 ? sortedDates : ['Hari Ini'],
      pendapatan: sortedDates.length > 0 ? sortedDates.map(d => trendMap[d].pendapatan) : [0],
      biaya: sortedDates.length > 0 ? sortedDates.map(d => trendMap[d].biaya) : [0]
    };

    res.json({
      summary: {
        total_mobil,
        total_pendapatan,
        total_biaya,
        total_keuntungan_bersih: total_pendapatan - total_biaya
      },
      detail_unit: detailMobil,
      trend_harian
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data dashboard' });
  }
});

// Laporan Investor (Hanya untuk Admin & Investor)
app.get('/api/laporan/investor', authenticateToken, requireRole('admin', 'investor'), async (req, res) => {
  try {
    const { filter, start, end, mobil_id } = req.query;
    const allTx = await dbService.getTransaksi();
    const allMobil = await dbService.getMobil();
    const filteredTx = filterTxByPeriod(allTx, filter, start, end);

    let mobilInvestor = allMobil.filter(m => m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor');
    if (mobil_id && mobil_id !== 'all') {
      const targetId = parseInt(mobil_id);
      mobilInvestor = mobilInvestor.filter(m => m.id === targetId);
    }

    let total_pendapatan = 0;
    let total_biaya = 0;
    let total_bbm_all = 0;
    let total_servis_all = 0;
    let total_lainnya_all = 0;

    const rekapInvestor = [];

    mobilInvestor.forEach(m => {
      const tx = filteredTx
        .filter(t => t.mobil_id === m.id)
        .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));

      const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = tx.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = tx.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = tx.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      if (tx.length > 0) {
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
    const { filter, start, end } = req.query;
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

    allMobil.forEach(m => {
      const tx = filteredTx.filter(t => t.mobil_id === m.id);
      const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
      const bbm = tx.reduce((s, t) => s + (t.biaya_bbm || 0), 0);
      const servis = tx.reduce((s, t) => s + (t.biaya_servis || 0), 0);
      const lainnya = tx.reduce((s, t) => s + (t.biaya_lainnya || 0), 0);
      const bia = bbm + servis + lainnya;
      const laba_bersih = pend - bia;

      if (tx.length > 0) {
        const isInv = m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor';
        const porsi_peng = isInv ? Math.round(pend * 0.30) : laba_bersih;
        const porsi_inv = isInv ? (Math.round(pend * 0.70) - bia) : 0;

        total_pendapatan += pend;
        total_biaya += bia;
        total_bbm_all += bbm;
        total_servis_all += servis;
        total_lainnya_all += lainnya;
        total_porsi_pengelola += porsi_peng;
        total_porsi_investor += porsi_inv;

        detail_unit.push({
          id_mobil: m.id,
          nama_mobil: m.nama_mobil,
          plat_nomor: m.plat_nomor,
          tahun: m.tahun,
          kepemilikan: isInv ? 'Investor' : 'JRCTRANS (Sendiri)',
          is_investor: isInv,
          total_transaksi: tx.length,
          total_pendapatan: pend,
          biaya_bbm: bbm,
          biaya_servis: servis,
          biaya_lainnya: lainnya,
          total_biaya: bia,
          laba_bersih,
          porsi_pengelola: porsi_peng,
          porsi_investor: porsi_inv
        });
      }
    });

    res.json({
      periode: { filter: filter || 'all', start: start || '-', end: end || '-' },
      summary: {
        total_transaksi: filteredTx.length,
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
    console.log(`Server JRCTRANS Berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;