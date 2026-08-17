require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'secret_key_jrctrans_majalengka';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================================================
// PERSISTENSI DATA STORAGE (Lokal DB File)
// ===================================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const defaultData = {
  users: [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
    { id: 2, username: 'investor', password: 'investor123', role: 'investor' },
    { id: 3, username: 'supir', password: 'supir123', role: 'supir' }
  ],
  dataMobil: [
    { id: 1, nama_mobil: 'Innova Reborn', plat_nomor: 'E 1995 VLS', tahun: 2021, kepemilikan: 'investor', status_sewa: 'Tersedia', tgl_kembali: '-' },
    { id: 2, nama_mobil: 'Avanza Veloz', plat_nomor: 'E 1234 ABC', tahun: 2022, kepemilikan: 'sendiri', status_sewa: 'Sewa', tgl_kembali: '-' }
  ],
  dataTransaksi: [
    { 
      id: 1, 
      mobil_id: 1, 
      tanggal: '2026-08-14', 
      penyewa: 'Budi Santoso', 
      tarif: 600000, 
      tarif_sewa: 600000,
      biaya_bbm: 100000, 
      biaya_servis: 0, 
      biaya_lainnya: 20000, 
      keterangan: 'Sewa Harian Bandung' 
    }
  ]
};

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
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
    console.error('Error membaca database.json, menggunakan default:', err);
    return defaultData;
  }
}

let db = loadDatabase();

function saveDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Gagal menyimpan ke database.json:', err);
  }
}

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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const foundUser = db.users.find(u => u.username === username && u.password === password);
  if (foundUser) {
    const token = jwt.sign({ username: foundUser.username, role: foundUser.role }, SECRET_KEY, { expiresIn: '1d' });
    return res.json({ token, username: foundUser.username, role: foundUser.role });
  }

  return res.status(400).json({ error: 'Username atau Password salah!' });
});

// Endpoint Tambah User Baru (Khusus Admin)
app.post('/api/users', authenticateToken, requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, dan role wajib diisi!' });
  }

  const existing = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'Username sudah digunakan!' });
  }

  const roleClean = role.toLowerCase().trim();
  let assignedRole = 'supir';
  if (roleClean === 'admin') assignedRole = 'admin';
  else if (roleClean === 'investor') assignedRole = 'investor';
  else if (roleClean === 'supir') assignedRole = 'supir';

  const newUser = {
    id: db.users.length > 0 ? db.users[db.users.length - 1].id + 1 : 1,
    username: username.trim(),
    password: password.trim(),
    role: assignedRole
  };

  db.users.push(newUser);
  saveDatabase();
  res.json({ message: 'User baru berhasil dibuat!', user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

// ===================================================
// 2. ARMADA (CRUD Lengkap)
// ===================================================
app.get('/api/mobil', authenticateToken, (req, res) => {
  res.json(db.dataMobil);
});

app.post('/api/mobil', authenticateToken, requireRole('admin'), (req, res) => {
  const { nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali } = req.body;
  if (!nama_mobil || !plat_nomor) {
    return res.status(400).json({ error: 'Nama mobil dan plat nomor wajib diisi!' });
  }

  const isInvestor = kepemilikan && kepemilikan.toLowerCase().includes('investor');

  const newMobil = {
    id: db.dataMobil.length > 0 ? db.dataMobil[db.dataMobil.length - 1].id + 1 : 1,
    nama_mobil: nama_mobil.trim(),
    plat_nomor: plat_nomor.trim().toUpperCase(),
    tahun: parseInt(tahun) || new Date().getFullYear(),
    kepemilikan: isInvestor ? 'investor' : 'sendiri',
    status_sewa: status_sewa ? (status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1)) : 'Tersedia',
    tgl_kembali: tgl_kembali || '-'
  };

  db.dataMobil.push(newMobil);
  saveDatabase();
  res.json({ message: 'Armada mobil berhasil ditambahkan!', data: newMobil });
});

// Edit status mobil cepat (Admin only)
app.put('/api/mobil/:id/status', authenticateToken, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.dataMobil.findIndex(m => m.id === id);
  if (index === -1) return res.status(404).json({ error: 'Armada tidak ditemukan!' });

  const { status_sewa, tgl_kembali } = req.body;
  if (status_sewa) {
    db.dataMobil[index].status_sewa = status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1);
  }
  if (tgl_kembali !== undefined) {
    db.dataMobil[index].tgl_kembali = tgl_kembali;
  }

  saveDatabase();
  res.json({ message: 'Status armada berhasil diperbarui!', data: db.dataMobil[index] });
});

// Edit lengkap armada (Admin only)
app.put('/api/mobil/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.dataMobil.findIndex(m => m.id === id);
  if (index === -1) return res.status(404).json({ error: 'Armada tidak ditemukan!' });

  const { nama_mobil, plat_nomor, tahun, kepemilikan, status_sewa, tgl_kembali } = req.body;
  const isInvestor = kepemilikan && kepemilikan.toLowerCase().includes('investor');

  db.dataMobil[index] = {
    ...db.dataMobil[index],
    nama_mobil: nama_mobil ? nama_mobil.trim() : db.dataMobil[index].nama_mobil,
    plat_nomor: plat_nomor ? plat_nomor.trim().toUpperCase() : db.dataMobil[index].plat_nomor,
    tahun: parseInt(tahun) || db.dataMobil[index].tahun,
    kepemilikan: isInvestor ? 'investor' : 'sendiri',
    status_sewa: status_sewa ? (status_sewa.charAt(0).toUpperCase() + status_sewa.slice(1)) : db.dataMobil[index].status_sewa,
    tgl_kembali: tgl_kembali !== undefined ? tgl_kembali : db.dataMobil[index].tgl_kembali
  };

  saveDatabase();
  res.json({ message: 'Data armada berhasil diperbarui!', data: db.dataMobil[index] });
});

// Hapus armada (Admin only)
app.delete('/api/mobil/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  db.dataMobil = db.dataMobil.filter(m => m.id !== id);
  saveDatabase();
  res.json({ message: 'Armada berhasil dihapus!' });
});

// ===================================================
// 3. TRANSAKSI (CRUD Lengkap - Khusus Admin)
// ===================================================
app.get('/api/transaksi', authenticateToken, (req, res) => {
  const result = db.dataTransaksi.map(t => {
    const mobil = db.dataMobil.find(m => m.id === t.mobil_id) || {};
    return { 
      ...t, 
      tarif_sewa: t.tarif, // Dukungan properti ganda
      nama_mobil: mobil.nama_mobil || '-', 
      plat_nomor: mobil.plat_nomor || '-' 
    };
  });
  res.json(result);
});

app.post('/api/transaksi', authenticateToken, requireRole('admin'), (req, res) => {
  const { mobil_id, tanggal, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan } = req.body;
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;

  const newTx = {
    id: db.dataTransaksi.length > 0 ? db.dataTransaksi[db.dataTransaksi.length - 1].id + 1 : 1,
    mobil_id: parseInt(mobil_id),
    tanggal: tanggal || new Date().toISOString().split('T')[0],
    penyewa: penyewa ? penyewa.trim() : '-',
    tarif: tarifNilai,
    tarif_sewa: tarifNilai,
    biaya_bbm: parseFloat(biaya_bbm) || 0,
    biaya_servis: parseFloat(biaya_servis) || 0,
    biaya_lainnya: parseFloat(biaya_lainnya) || 0,
    keterangan: keterangan ? keterangan.trim() : '-'
  };

  db.dataTransaksi.push(newTx);
  saveDatabase();
  res.json({ message: 'Transaksi berhasil disimpan!', data: newTx });
});

// Update transaksi (Admin only)
app.put('/api/transaksi/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const index = db.dataTransaksi.findIndex(t => t.id === id);

  if (index === -1) return res.status(404).json({ error: 'Transaksi tidak ditemukan!' });

  const { mobil_id, tanggal, penyewa, tarif, tarif_sewa, biaya_bbm, biaya_servis, biaya_lainnya, keterangan } = req.body;
  const tarifNilai = parseFloat(tarif !== undefined ? tarif : tarif_sewa) || 0;

  db.dataTransaksi[index] = {
    ...db.dataTransaksi[index],
    mobil_id: parseInt(mobil_id),
    tanggal: tanggal || db.dataTransaksi[index].tanggal,
    penyewa: penyewa ? penyewa.trim() : db.dataTransaksi[index].penyewa,
    tarif: tarifNilai,
    tarif_sewa: tarifNilai,
    biaya_bbm: parseFloat(biaya_bbm) || 0,
    biaya_servis: parseFloat(biaya_servis) || 0,
    biaya_lainnya: parseFloat(biaya_lainnya) || 0,
    keterangan: keterangan !== undefined ? keterangan.trim() : db.dataTransaksi[index].keterangan
  };

  saveDatabase();
  res.json({ message: 'Transaksi berhasil diperbarui!', data: db.dataTransaksi[index] });
});

// Hapus transaksi (Admin only)
app.delete('/api/transaksi/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  db.dataTransaksi = db.dataTransaksi.filter(t => t.id !== id);
  saveDatabase();
  res.json({ message: 'Transaksi berhasil dihapus!' });
});

// ===================================================
// 4. LAPORAN & DASHBOARD
// ===================================================
app.get('/api/laporan/dashboard', authenticateToken, (req, res) => {
  const { filter, start, end } = req.query;
  const filteredTx = filterTxByPeriod(db.dataTransaksi, filter, start, end);

  const total_mobil = db.dataMobil.length;
  let total_pendapatan = 0;
  let total_biaya = 0;

  const detailMobil = db.dataMobil.map(m => {
    const txMobil = filteredTx.filter(t => t.mobil_id === m.id);
    const pend = txMobil.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
    const bia = txMobil.reduce((s, t) => s + ((t.biaya_bbm || 0) + (t.biaya_servis || 0) + (t.biaya_lainnya || 0)), 0);
    const laba_bersih = pend - bia;

    total_pendapatan += pend;
    total_biaya += bia;

    const isInv = m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor';
    const porsi_investor = isInv ? (laba_bersih > 0 ? laba_bersih * 0.70 : 0) : 0;
    const porsi_pengelola = isInv ? (laba_bersih > 0 ? laba_bersih * 0.30 : laba_bersih) : laba_bersih;

    return {
      id: m.id,
      nama_mobil: m.nama_mobil,
      plat_nomor: m.plat_nomor,
      kepemilikan: isInv ? 'Investor' : 'JRCTRANS',
      status_sewa: m.status_sewa || 'Tersedia',
      tgl_kembali: m.tgl_kembali || '-',
      total_pendapatan: pend,
      total_biaya: bia,
      laba_bersih,
      porsi_pengelola,
      porsi_investor
    };
  });

  // Agregasi tren harian riil untuk Line Chart
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
});

// Laporan Investor (Hanya untuk Admin & Investor)
app.get('/api/laporan/investor', authenticateToken, requireRole('admin', 'investor'), (req, res) => {
  const { filter, start, end } = req.query;
  const filteredTx = filterTxByPeriod(db.dataTransaksi, filter, start, end);

  const mobilInvestor = db.dataMobil.filter(m => m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor');

  let total_pendapatan = 0;
  let total_biaya = 0;

  // Hanya sertakan unit yang memiliki transaksi aktif pada periode terpilih (agar setelah hapus transaksi tidak muncul baris Rp 0)
  const rekapInvestor = [];

  mobilInvestor.forEach(m => {
    const tx = filteredTx.filter(t => t.mobil_id === m.id);
    const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
    const bia = tx.reduce((s, t) => s + ((t.biaya_bbm || 0) + (t.biaya_servis || 0) + (t.biaya_lainnya || 0)), 0);
    const laba_bersih = pend - bia;

    if (tx.length > 0) {
      total_pendapatan += pend;
      total_biaya += bia;

      const porsi_investor = laba_bersih > 0 ? laba_bersih * 0.70 : 0;
      const porsi_pengelola = laba_bersih > 0 ? laba_bersih * 0.30 : laba_bersih;

      rekapInvestor.push({
        id_mobil: m.id,
        nama_mobil: m.nama_mobil,
        plat_nomor: m.plat_nomor,
        tahun: m.tahun,
        kepemilikan: 'Investor',
        total_pendapatan: pend,
        total_biaya: bia,
        laba_bersih,
        hak_investor_70: porsi_investor,
        porsi_pengelola_30: porsi_pengelola
      });
    }
  });

  res.json({
    periode: { filter: filter || 'all', start: start || '-', end: end || '-' },
    summary: {
      total_pendapatan,
      total_biaya,
      laba_bersih: total_pendapatan - total_biaya,
      total_hak_investor: rekapInvestor.reduce((s, r) => s + r.hak_investor_70, 0),
      total_porsi_pengelola: rekapInvestor.reduce((s, r) => s + r.porsi_pengelola_30, 0)
    },
    detail_unit: rekapInvestor
  });
});

// ===================================================
// 5. ALL REPORT (LAPORAN KESELURUHAN - KHUSUS ADMIN)
// ===================================================
app.get('/api/laporan/keseluruhan', authenticateToken, requireRole('admin'), (req, res) => {

  const { filter, start, end } = req.query;
  const filteredTx = filterTxByPeriod(db.dataTransaksi, filter, start, end);

  let total_pendapatan = 0;
  let total_biaya = 0;
  let total_porsi_pengelola = 0;
  let total_porsi_investor = 0;

  const detail_unit = [];

  db.dataMobil.forEach(m => {
    const tx = filteredTx.filter(t => t.mobil_id === m.id);
    const pend = tx.reduce((s, t) => s + (t.tarif || t.tarif_sewa || 0), 0);
    const bia = tx.reduce((s, t) => s + ((t.biaya_bbm || 0) + (t.biaya_servis || 0) + (t.biaya_lainnya || 0)), 0);
    const laba_bersih = pend - bia;

    if (tx.length > 0) {
      const isInv = m.kepemilikan && m.kepemilikan.toLowerCase() === 'investor';
      const porsi_inv = isInv ? (laba_bersih > 0 ? laba_bersih * 0.70 : 0) : 0;
      const porsi_peng = isInv ? (laba_bersih > 0 ? laba_bersih * 0.30 : laba_bersih) : laba_bersih;

      total_pendapatan += pend;
      total_biaya += bia;
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
      total_laba_bersih: total_pendapatan - total_biaya,
      total_porsi_pengelola,
      total_porsi_investor
    },
    detail_unit
  });
});

app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server JRCTRANS Berjalan di http://localhost:${PORT}`);
});