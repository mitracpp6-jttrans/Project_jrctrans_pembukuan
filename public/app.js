const BASE_URL = window.location.origin;
    let lineChart, barChart, pieChart;
    let cachedTransaksiList = [];
    let cachedArchivesList = [];
    let currentTab = 'dashboard';
    let globalActiveFilter = 'bulan_ini';
    let globalStartDate = '';
    let globalEndDate = '';
    let currentAllReportCategory = 'all';

    // =========================================================================
    // GLOBAL STATE MANAGEMENT (PUB/SUB)
    // =========================================================================
    window.AppState = {
        data: {
            dashboard: null,
            mobil: [],
            transaksi: [],
            investor: null,
            admin: null,
            archives: []
        },
        listeners: [],
        isFetching: false,
        
        subscribe(listener) {
            this.listeners.push(listener);
        },
        
        notify() {
            this.listeners.forEach(fn => fn(this.data));
        },
        
        async fetchAndSync(force = false) {
            if (this.isFetching && !force) return;
            this.isFetching = true;
            try {
                let query = `?filter=${globalActiveFilter}`;
                if (globalActiveFilter === 'custom' && globalStartDate && globalEndDate) {
                    query += `&start=${globalStartDate}&end=${globalEndDate}`;
                }

                const [dashboard, mobil, transaksi, investor, admin, archives] = await Promise.all([
                    apiFetch(`/api/laporan/dashboard${query}`),
                    apiFetch('/api/mobil'),
                    apiFetch(`/api/transaksi${query}`),
                    apiFetch(`/api/laporan/investor${query}`),
                    apiFetch(`/api/laporan/keseluruhan${query}`),
                    apiFetch('/api/riwayat-bulanan')
                ]);

                this.data = { dashboard, mobil, transaksi, investor, admin, archives };
                this.notify();
            } catch (err) {
                console.error("Global State Sync Error:", err);
            } finally {
                this.isFetching = false;
            }
        }
    };


    // =========================================================================
    // SISTEM IDLE TIMEOUT & AUTO-LOGOUT REALTIME (15 MENIT)
    // =========================================================================
    const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 Menit (900.000 ms)
    let idleCheckTimer = null;
    let lastActivityThrottle = 0;
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

    function recordUserActivity() {
      const now = Date.now();
      // Throttle pencatatan aktivitas maksimal 1x per 2 detik demi performa tinggi
      if (now - lastActivityThrottle > 2000) {
        lastActivityThrottle = now;
        localStorage.setItem('JRC_last_activity', now.toString());
      }
    }

    function checkIdleStatus() {
      const token = localStorage.getItem('JRC_token');
      if (!token) return;

      const lastActivity = Number(localStorage.getItem('JRC_last_activity') || Date.now());
      const idleDuration = Date.now() - lastActivity;

      if (idleDuration >= IDLE_TIMEOUT_MS) {
        triggerLogout('idle');
      }
    }

    let silentRefreshTimer = null;

    async function silentRefreshData() {
      await window.AppState.fetchAndSync();
    }

    function startIdleTracker() {
      // Set timestamp awal aktivitas
      const now = Date.now();
      localStorage.setItem('JRC_last_activity', now.toString());
      lastActivityThrottle = now;

      // Pasang event listener aktivitas pengguna
      ACTIVITY_EVENTS.forEach(evt => {
        window.addEventListener(evt, recordUserActivity, { passive: true });
      });

      // Interval pemeriksaan idle periodik setiap 10 detik
      if (idleCheckTimer) clearInterval(idleCheckTimer);
      idleCheckTimer = setInterval(checkIdleStatus, 10000);

      // Interval sinkronisasi data live setiap 15 detik
      if (silentRefreshTimer) clearInterval(silentRefreshTimer);
      silentRefreshTimer = setInterval(silentRefreshData, 15000);

      // Tangani saat tab browser dibuka kembali dari background / sleep mode
      document.addEventListener('visibilitychange', onVisibilityOrFocusChange);
      window.addEventListener('focus', onVisibilityOrFocusChange);
    }

    function stopIdleTracker() {
      ACTIVITY_EVENTS.forEach(evt => {
        window.removeEventListener(evt, recordUserActivity);
      });
      if (idleCheckTimer) {
        clearInterval(idleCheckTimer);
        idleCheckTimer = null;
      }
      if (silentRefreshTimer) {
        clearInterval(silentRefreshTimer);
        silentRefreshTimer = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityOrFocusChange);
      window.removeEventListener('focus', onVisibilityOrFocusChange);
    }

    function onVisibilityOrFocusChange() {
      if (document.visibilityState === 'visible') {
        checkIdleStatus();
      }
    }

    // Sinkronisasi status logout lintas-tab browser
    window.addEventListener('storage', (e) => {
      if (e.key === 'token' && !e.newValue) {
        // Tab lain melakukan logout
        triggerLogout('storage');
      }
    });

    // Tampilkan notifikasi peringatan di layar login
    function showLoginAlert(type, title, message) {
      const banner = document.getElementById('login-alert-banner');
      const icon = document.getElementById('login-alert-icon');
      const titleEl = document.getElementById('login-alert-title');
      const msgEl = document.getElementById('login-alert-msg');
      if (!banner) return;

      banner.className = 'mb-4 p-3.5 rounded-xl border text-xs font-semibold flex items-start gap-2.5 transition-all';
      if (type === 'idle') {
        banner.classList.add('bg-amber-50', 'border-amber-300', 'text-amber-900');
        icon.className = 'fa-solid fa-clock-rotate-left text-base mt-0.5 shrink-0 text-amber-600';
      } else if (type === 'expired') {
        banner.classList.add('bg-red-50', 'border-red-300', 'text-red-900');
        icon.className = 'fa-solid fa-triangle-exclamation text-base mt-0.5 shrink-0 text-red-600';
      } else if (type === 'manual') {
        banner.classList.add('bg-emerald-50', 'border-emerald-300', 'text-emerald-900');
        icon.className = 'fa-solid fa-circle-check text-base mt-0.5 shrink-0 text-emerald-600';
      } else {
        banner.classList.add('bg-blue-50', 'border-blue-300', 'text-blue-900');
        icon.className = 'fa-solid fa-circle-info text-base mt-0.5 shrink-0 text-blue-600';
      }

      titleEl.innerText = title;
      msgEl.innerText = message;
      banner.classList.remove('hidden');
    }

    function hideLoginAlert() {
      const banner = document.getElementById('login-alert-banner');
      if (banner) banner.classList.add('hidden');
    }

    function showLoginScreen() {
      stopIdleTracker();
      document.getElementById('auth-container').classList.remove('hidden');
      document.getElementById('app-container').classList.add('hidden');
      const profileMenu = document.getElementById('profile-menu');
      if (profileMenu) profileMenu.classList.add('hidden');
    }

    function triggerLogout(reason = 'manual') {
      stopIdleTracker();

      localStorage.removeItem('JRC_token'); localStorage.removeItem('token');
      localStorage.removeItem('JRC_role'); localStorage.removeItem('role');
      localStorage.removeItem('JRC_username'); localStorage.removeItem('username');
      localStorage.removeItem('JRC_last_activity'); localStorage.removeItem('jrc_last_activity');

      // Reset state & memory caches
      cachedTransaksiList = [];
      cachedArchivesList = [];
      currentTab = 'dashboard';

      // Pastikan seluruh container tab disembunyikan dan dikembalikan ke dashboard
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      const dashSec = document.getElementById('tab-dashboard');
      if (dashSec) dashSec.classList.remove('hidden');

      showLoginScreen();

      if (reason === 'idle') {
        showLoginAlert(
          'idle',
          'Sesi Berakhir (Tidak Ada Aktivitas)',
          'Anda telah keluar secara otomatis karena tidak ada aktivitas selama 15 menit. Silakan masuk kembali.'
        );
      } else if (reason === 'expired') {
        showLoginAlert(
          'expired',
          'Sesi Kedaluwarsa',
          'Masa aktif sesi/token login Anda telah berakhir. Silakan masuk kembali untuk melanjutkan.'
        );
      } else if (reason === 'manual') {
        showLoginAlert(
          'manual',
          'Berhasil Keluar',
          'Anda telah keluar dari aplikasi secara aman.'
        );
      }
    }

    function logout() {
      triggerLogout('manual');
    }

    // Helper API Fetch dengan Penanganan Token Expired Otomatis & Anti-Cache
    async function apiFetch(url, options = {}) {
      const token = localStorage.getItem('JRC_token');
      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
      };

      const res = await fetch(`${BASE_URL}${url}`, {
        cache: 'no-store',
        ...options,
        headers
      });
      if (res.status === 401 || res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        if (token) {
          triggerLogout('expired');
        }
        throw new Error(errData.error || 'Akses ditolak atau sesi telah berakhir');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Gagal memproses permintaan (HTTP ${res.status})`);
      }
      return data;
    }

    // Format Rupiah
    function formatRp(v) {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
    }

    // Auth Handlers
    async function handleLogin(e) {
      e.preventDefault();
      hideLoginAlert();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      try {
        const res = await fetch(`${BASE_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Gagal login');

        localStorage.setItem('JRC_token', data.token);
        localStorage.setItem('JRC_role', data.role);
        localStorage.setItem('JRC_username', data.username);
        localStorage.setItem('JRC_last_activity', Date.now().toString());

        if (passwordInput) passwordInput.value = '';

        await initApp();
      } catch (err) {
        showLoginAlert('expired', 'Gagal Masuk', err.message);
      }
    }

    // Profile Menu Toggle
    function toggleProfileMenu() {
      const menu = document.getElementById('profile-menu');
      if (menu) menu.classList.toggle('hidden');
    }

    // Modal Create User Handlers
    function openCreateUserModal() {
      const menu = document.getElementById('profile-menu');
      if (menu) menu.classList.add('hidden');
      const modal = document.getElementById('modal-create-user');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function closeCreateUserModal() {
      const modal = document.getElementById('modal-create-user');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    }

    async function simpanUserBaru(e) {
      e.preventDefault();
      const body = {
        username: document.getElementById('user-username').value,
        password: document.getElementById('user-password').value,
        role: document.getElementById('user-role').value
      };

      try {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        closeCreateUserModal();
        e.target.reset();
        alert('User baru berhasil didaftarkan!');
      } catch (err) {
        alert(err.message);
      }
    }

    // =========================================================================
    // UNIFIED PERIOD FILTER & CROSS-MODULE SYNCHRONIZATION
    // =========================================================================
    function syncFilterSelects(val) {
      const ids = [
        'dashboard-filter-select',
        'transaksi-filter-select',
        'report-filter-type',
        'allreport-filter-type'
      ];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.value = val;
        }
      });

      // Toggle custom date containers if 'custom' is active
      const isCustom = val === 'custom';
      const customReport = document.getElementById('custom-date-inputs');
      const customAllReport = document.getElementById('allreport-custom-date-inputs');
      if (customReport) customReport.classList.toggle('hidden', !isCustom);
      if (customAllReport) customAllReport.classList.toggle('hidden', !isCustom);

      if (isCustom) {
        if (globalStartDate) {
          const s1 = document.getElementById('report-start');
          const s2 = document.getElementById('allreport-start');
          if (s1) s1.value = globalStartDate;
          if (s2) s2.value = globalStartDate;
        }
        if (globalEndDate) {
          const e1 = document.getElementById('report-end');
          const e2 = document.getElementById('allreport-end');
          if (e1) e1.value = globalEndDate;
          if (e2) e2.value = globalEndDate;
        }
      }
    }

    function onGlobalFilterChange(source, newFilter) {
      globalActiveFilter = newFilter;
      syncFilterSelects(newFilter);

      if (newFilter !== 'custom') {
        refreshActiveTab();
      }
    }

    function onReportFilterChange() {
      const sel = document.getElementById('report-filter-type');
      if (sel) onGlobalFilterChange('report', sel.value);
    }

    function onAllReportFilterChange() {
      const sel = document.getElementById('allreport-filter-type');
      if (sel) onGlobalFilterChange('all-report', sel.value);
    }

    function applyGlobalCustomDates(start, end) {
      if (!start || !end) {
        alert('Mohon tentukan tanggal awal dan tanggal akhir!');
        return;
      }
      if (start > end) {
        alert('Tanggal awal tidak boleh lebih besar dari tanggal akhir!');
        return;
      }
      globalActiveFilter = 'custom';
      globalStartDate = start;
      globalEndDate = end;
      syncFilterSelects('custom');
      refreshActiveTab();
    }

    async function populateAllFilterDropdowns() {
      try {
        const archives = await apiFetch('/api/riwayat-bulanan');
        cachedArchivesList = archives || [];

        const optgroups = [
          document.getElementById('optgroup-riwayat-arsip'),
          document.getElementById('optgroup-transaksi-arsip'),
          document.getElementById('optgroup-report-arsip'),
          document.getElementById('optgroup-allreport-arsip')
        ];

        optgroups.forEach(og => {
          if (!og) return;
          og.innerHTML = '';
          if (cachedArchivesList.length === 0) {
            og.innerHTML = '<option disabled class="text-gray-400">Belum ada riwayat tutup buku</option>';
          } else {
            cachedArchivesList.forEach(a => {
              const opt = document.createElement('option');
              opt.value = `archive:${a.periode}`;
              opt.innerText = `📁 ${a.nama_bulan} ${a.tahun} (Tutup Buku - ${a.total_transaksi || 0} trx)`;
              og.appendChild(opt);
            });
          }
        });

        syncFilterSelects(globalActiveFilter);
      } catch (err) {
        console.warn('Gagal memuat opsi riwayat arsip:', err);
      }
    }

    // Refresh active tab based on currentTab state
    async function refreshActiveTab() {
      if (currentTab === 'dashboard') await window.AppState.fetchAndSync(true);
      else if (currentTab === 'armada') await window.AppState.fetchAndSync(true);
      else if (currentTab === 'transaksi') await window.AppState.fetchAndSync(true);
      else if (currentTab === 'report') await window.AppState.fetchAndSync(true);
      else if (currentTab === 'all-report') await window.AppState.fetchAndSync(true);
    }

    async function refreshAllModules() {
      await populateAllFilterDropdowns();
      await populateReportMobilDropdown();
      await populateAllReportMobilDropdown();
      await window.AppState.fetchAndSync(true);
    }

    // =========================================================================
    // INITIALIZATION & TAB NAVIGATION
    // =========================================================================
    async function initApp() {
      // 0. Bind Reaktivitas UI ke Global State
      if (window.AppState.listeners.length === 0) {
        window.AppState.subscribe(() => {
          if (currentTab === 'dashboard') loadDashboard();
          if (currentTab === 'armada') loadArmada();
          if (currentTab === 'transaksi') loadTransaksi();
          if (currentTab === 'report') loadReport();
          if (currentTab === 'all-report') loadAllReport();
        });
      }

      const token = localStorage.getItem('JRC_token');
      if (!token) {
        showLoginScreen();
        return;
      }

      // 1. Periksa apakah sesi sebelumnya sudah inaktif melebihi batas 15 menit
      const lastAct = Number(localStorage.getItem('JRC_last_activity') || 0);
      if (lastAct && (Date.now() - lastAct >= IDLE_TIMEOUT_MS)) {
        triggerLogout('idle');
        return;
      }

      // 2. Verifikasi validitas token ke server backend
      try {
        const verify = await apiFetch('/api/auth/me');
        if (!verify || !verify.valid) {
          triggerLogout('expired');
          return;
        }
      } catch (err) {
        // apiFetch otomatis memanggil triggerLogout('expired')
        return;
      }

      // 3. Aktifkan sistem pemantau aktivitas (idle tracker)
      startIdleTracker();

      const role = (localStorage.getItem('JRC_role') || 'admin').toLowerCase();
      const username = localStorage.getItem('JRC_username') || 'User';

      document.getElementById('auth-container').classList.add('hidden');
      document.getElementById('app-container').classList.remove('hidden');
      hideLoginAlert();

      document.getElementById('user-display-name').innerText = username;
      const roleBadge = document.getElementById('user-role-badge');
      roleBadge.innerText = role.toUpperCase();

      // Styling badge berdasarkan role
      roleBadge.className = 'text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full text-white';
      if (role === 'admin') {
        roleBadge.classList.add('bg-custom-green');
      } else if (role === 'investor') {
        roleBadge.classList.add('bg-purple-600');
      } else if (role === 'supir') {
        roleBadge.classList.add('bg-blue-600');
      }

      // Atur Hak Akses Navigasi & Tombol Berdasarkan Role
      const navDashboard = document.getElementById('nav-dashboard');
      const navArmada = document.getElementById('nav-armada');
      const navTransaksi = document.getElementById('nav-transaksi');
      const navReport = document.getElementById('nav-report');
      const navAllReport = document.getElementById('nav-all-report');
      const btnTambahArmada = document.getElementById('btn-tambah-armada');
      const btnTambahTransaksi = document.getElementById('btn-tambah-transaksi');
      const menuCreateUser = document.getElementById('menu-create-user');

      // Mobile Bottom Nav Elements
      const mobNavDashboard = document.getElementById('mob-nav-dashboard');
      const mobNavArmada = document.getElementById('mob-nav-armada');
      const mobNavTransaksi = document.getElementById('mob-nav-transaksi');
      const mobNavReport = document.getElementById('mob-nav-report');
      const mobNavAllReport = document.getElementById('mob-nav-all-report');

      if (role === 'supir') {
        if (navDashboard) navDashboard.classList.remove('hidden');
        if (navArmada) navArmada.classList.add('hidden');
        if (navTransaksi) navTransaksi.classList.add('hidden');
        if (navReport) navReport.classList.add('hidden');
        if (navAllReport) navAllReport.classList.add('hidden');
        if (btnTambahArmada) btnTambahArmada.classList.add('hidden');
        if (btnTambahTransaksi) btnTambahTransaksi.classList.add('hidden');
        if (menuCreateUser) menuCreateUser.classList.add('hidden');

        if (mobNavDashboard) mobNavDashboard.classList.remove('hidden');
        if (mobNavArmada) mobNavArmada.classList.add('hidden');
        if (mobNavTransaksi) mobNavTransaksi.classList.add('hidden');
        if (mobNavReport) mobNavReport.classList.add('hidden');
        if (mobNavAllReport) mobNavAllReport.classList.add('hidden');
      } else if (role === 'investor') {
        if (navDashboard) navDashboard.classList.remove('hidden');
        if (navArmada) navArmada.classList.add('hidden');
        if (navTransaksi) navTransaksi.classList.add('hidden');
        if (navReport) navReport.classList.remove('hidden');
        if (navAllReport) navAllReport.classList.add('hidden');
        if (btnTambahArmada) btnTambahArmada.classList.add('hidden');
        if (btnTambahTransaksi) btnTambahTransaksi.classList.add('hidden');
        if (menuCreateUser) menuCreateUser.classList.add('hidden');

        if (mobNavDashboard) mobNavDashboard.classList.remove('hidden');
        if (mobNavArmada) mobNavArmada.classList.add('hidden');
        if (mobNavTransaksi) mobNavTransaksi.classList.add('hidden');
        if (mobNavReport) mobNavReport.classList.remove('hidden');
        if (mobNavAllReport) mobNavAllReport.classList.add('hidden');
      } else {
        if (navDashboard) navDashboard.classList.remove('hidden');
        if (navArmada) navArmada.classList.remove('hidden');
        if (navTransaksi) navTransaksi.classList.remove('hidden');
        if (navReport) navReport.classList.remove('hidden');
        if (navAllReport) navAllReport.classList.remove('hidden');
        if (btnTambahArmada) btnTambahArmada.classList.remove('hidden');
        if (btnTambahTransaksi) btnTambahTransaksi.classList.remove('hidden');
        if (menuCreateUser) menuCreateUser.classList.remove('hidden');

        if (mobNavDashboard) mobNavDashboard.classList.remove('hidden');
        if (mobNavArmada) mobNavArmada.classList.remove('hidden');
        if (mobNavTransaksi) mobNavTransaksi.classList.remove('hidden');
        if (mobNavReport) mobNavReport.classList.remove('hidden');
        if (mobNavAllReport) mobNavAllReport.classList.remove('hidden');
      }

      // Pastikan navigasi selalu diarahkan ke dashboard saat baru login
      switchTab('dashboard');

      await populateAllFilterDropdowns();
      await populateReportMobilDropdown();
      await populateAllReportMobilDropdown();
      await window.AppState.fetchAndSync(true);
      await window.AppState.fetchAndSync(true);

      document.getElementById('report-date-stamp').innerText = new Date().toLocaleDateString('id-ID');
      const stampAll = document.getElementById('allreport-date-stamp');
      if (stampAll) stampAll.innerText = new Date().toLocaleDateString('id-ID');
      
      const tglInput = document.getElementById('trx-tanggal');
      if (tglInput) tglInput.valueAsDate = new Date();
      const tglKembali = document.getElementById('trx-tgl-kembali');
      if (tglKembali) tglKembali.valueAsDate = new Date();
    }

    // Mobile Sidebar Toggle
    function toggleMobileSidebar() {
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar) sidebar.classList.toggle('-translate-x-full');
      if (backdrop) backdrop.classList.toggle('hidden');
    }

    // Switch Tabs Nav
    function switchTab(tab) {
      currentTab = tab;

      // Auto close mobile drawer on tab click
      if (window.innerWidth < 768) {
        const sidebar = document.getElementById('app-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
          sidebar.classList.add('-translate-x-full');
          if (backdrop) backdrop.classList.add('hidden');
        }
      }

      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.getElementById(`tab-${tab}`).classList.remove('hidden');

      // Update Desktop Sidebar Buttons
      document.querySelectorAll('#app-sidebar nav button').forEach(b => {
        b.classList.remove('bg-white/10', 'text-white');
        if (b.id === 'nav-all-report') {
          b.classList.add('text-amber-300');
        } else {
          b.classList.add('text-green-200');
        }
      });
      const activeDeskNav = document.getElementById(`nav-${tab}`);
      if (activeDeskNav) activeDeskNav.classList.add('bg-white/10', 'text-white');

      // Update Mobile Bottom Nav Active States
      document.querySelectorAll('#mobile-bottom-nav button').forEach(b => {
        b.classList.remove('text-custom-green', 'text-amber-600', 'font-black');
        b.classList.add('text-gray-400');
      });
      const activeMobNav = document.getElementById(`mob-nav-${tab}`);
      if (activeMobNav) {
        activeMobNav.classList.remove('text-gray-400');
        if (tab === 'all-report') {
          activeMobNav.classList.add('text-amber-600', 'font-black');
        } else {
          activeMobNav.classList.add('text-custom-green', 'font-black');
        }
      }

      // Sync active global filter to newly opened tab
      syncFilterSelects(globalActiveFilter);

      if (tab === 'dashboard') loadDashboard();
      else if (tab === 'armada') loadArmada();
      else if (tab === 'transaksi') loadTransaksi();
      else if (tab === 'report') {
        populateReportMobilDropdown();
        loadReport();
      }
      else if (tab === 'all-report') {
        populateAllReportMobilDropdown();
        loadAllReport();
      }
    }

    // Refresh Dashboard Handler with visual animation
    async function refreshDashboardClick() {
      const icon = document.getElementById('icon-refresh');
      const statusBadge = document.getElementById('dashboard-refresh-status');
      
      if (icon) icon.classList.add('fa-spin');
      await refreshAllModules();
      if (icon) icon.classList.remove('fa-spin');

      if (statusBadge) {
        statusBadge.classList.remove('hidden');
        setTimeout(() => statusBadge.classList.add('hidden'), 2500);
      }
    }

    // =========================================================================
    // MODAL CONTROLS
    // =========================================================================
    function openModalArmada() {
      document.getElementById('modal-armada').classList.remove('hidden');
      document.getElementById('modal-armada').classList.add('flex');
    }
    function closeModalArmada() {
      document.getElementById('modal-armada').classList.add('hidden');
      document.getElementById('modal-armada').classList.remove('flex');
    }

    async function openModalTransaksi() {
      try {
        const listMobil = await apiFetch('/api/mobil');
        const select = document.getElementById('trx-mobil-id');
        select.innerHTML = '<option value="">-- Pilih Armada --</option>';
        listMobil.forEach(m => {
          const isInv = (m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
          const tag = isInv ? '[INVESTOR]' : '[MILIK JRC TRANS]';
          select.innerHTML += `<option value="${m.id}">${m.nama_mobil} (${m.plat_nomor}) - ${tag}</option>`;
        });
      } catch (e) {
        console.error(e);
      }
      document.getElementById('modal-transaksi').classList.remove('hidden');
      document.getElementById('modal-transaksi').classList.add('flex');
    }
    function closeModalTransaksi() {
      document.getElementById('modal-transaksi').classList.add('hidden');
      document.getElementById('modal-transaksi').classList.remove('flex');
    }
    function onTrxTanggalMulaiChange() {
      const startVal = document.getElementById('trx-tanggal').value;
      const returnInput = document.getElementById('trx-tgl-kembali');
      if (returnInput && (!returnInput.value || returnInput.value < startVal)) {
        returnInput.value = startVal;
      }
    }

    async function openEditTransaksi(id) {
      const tx = cachedTransaksiList.find(t => Number(t.id) === Number(id));
      if (!tx) return;

      try {
        const listMobil = await apiFetch('/api/mobil');
        const select = document.getElementById('edit-trx-mobil-id');
        select.innerHTML = '<option value="">-- Pilih Armada --</option>';
        listMobil.forEach(m => {
          const isInv = (m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
          const tag = isInv ? '[INVESTOR]' : '[MILIK JRC TRANS]';
          select.innerHTML += `<option value="${m.id}" ${Number(m.id) === Number(tx.mobil_id) ? 'selected' : ''}>${m.nama_mobil} (${m.plat_nomor}) - ${tag}</option>`;
        });
      } catch (e) {
        console.error(e);
      }

      document.getElementById('edit-trx-id').value = tx.id;
      document.getElementById('edit-trx-tanggal').value = tx.tanggal || tx.tgl_mulai || '';
      document.getElementById('edit-trx-tgl-kembali').value = tx.tgl_kembali || tx.tanggal || '';
      document.getElementById('edit-trx-penyewa').value = tx.penyewa;
      document.getElementById('edit-trx-tarif').value = tx.tarif || tx.tarif_sewa || 0;
      document.getElementById('edit-trx-bbm').value = tx.biaya_bbm || 0;
      document.getElementById('edit-trx-servis').value = tx.biaya_servis || 0;
      document.getElementById('edit-trx-lainnya').value = tx.biaya_lainnya || 0;
      document.getElementById('edit-trx-keterangan').value = tx.keterangan || '';

      document.getElementById('modal-edit-transaksi').classList.remove('hidden');
      document.getElementById('modal-edit-transaksi').classList.add('flex');
    }

    function closeModalEditTransaksi() {
      document.getElementById('modal-edit-transaksi').classList.add('hidden');
      document.getElementById('modal-edit-transaksi').classList.remove('flex');
    }

    // =========================================================================
    // MODUL 1: DASHBOARD
    // =========================================================================
    async function loadDashboard() {
      try {
        let query = `?filter=${globalActiveFilter}`;
        if (globalActiveFilter === 'custom' && globalStartDate && globalEndDate) {
          query += `&start=${globalStartDate}&end=${globalEndDate}`;
        }

        const data = window.AppState.data.dashboard;
        const listMobil = window.AppState.data.mobil;
        if (!data || !listMobil) return;

        document.getElementById('card-total-unit').innerText = `${data.summary?.total_mobil || listMobil.length} Unit`;

        const isArchived = Boolean(data.periode?.is_archived);
        const archiveBanner = document.getElementById('dashboard-archive-banner');
        const periodBadgeWrapper = document.getElementById('dashboard-period-badge');

        if (isArchived) {
          if (archiveBanner) {
            archiveBanner.classList.remove('hidden');
            archiveBanner.classList.add('flex');
            const txt = document.getElementById('archive-banner-text');
            if (txt) {
              const closedDate = data.periode?.archived_info?.closed_at
                ? new Date(data.periode.archived_info.closed_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
                : '';
              txt.innerText = `Data periode ${data.periode.bulan} ${data.periode.tahun} telah dibekukan resmi (tutup buku)${closedDate ? ' pada ' + closedDate : ''}.`;
            }
          }
          if (periodBadgeWrapper) {
            periodBadgeWrapper.className = 'inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 rounded-full border border-amber-300 shadow-2xs';
            periodBadgeWrapper.innerHTML = `<i class="fa-solid fa-lock text-amber-700"></i> Arsip: <b id="dashboard-period-label">${data.periode.label}</b>`;
          }
        } else {
          if (archiveBanner) {
            archiveBanner.classList.add('hidden');
            archiveBanner.classList.remove('flex');
          }
          if (periodBadgeWrapper) {
            periodBadgeWrapper.className = 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 rounded-full border border-emerald-200 shadow-2xs';
            periodBadgeWrapper.innerHTML = `<i class="fa-solid fa-calendar-check text-emerald-600"></i> Siklus: <b id="dashboard-period-label">${data.periode.label}</b>`;
          }
        }

        const lblSuffix = isArchived
          ? `(${data.periode?.bulan || ''} ${data.periode?.tahun || ''})`
          : (globalActiveFilter === 'bulan_ini' ? `(${data.periode?.bulan || 'Bulan Ini'})` : (globalActiveFilter === 'hari_ini' ? '(Hari Ini)' : (globalActiveFilter === '7_hari' ? '(7 Hari)' : (globalActiveFilter === 'custom' ? `(${globalStartDate} - ${globalEndDate})` : '(Total)'))));

        const pEl = document.getElementById('lbl-dash-pendapatan');
        if (pEl) pEl.innerText = `Omset ${lblSuffix}`;
        const bEl = document.getElementById('lbl-dash-biaya');
        if (bEl) bEl.innerText = `Biaya Ops ${lblSuffix}`;
        const kEl = document.getElementById('lbl-dash-keuntungan');
        if (kEl) kEl.innerText = `Keuntungan ${lblSuffix}`;

        const totalPendapatan = Number(data.summary?.total_pendapatan || 0);
        const totalBiaya = Number(data.summary?.total_biaya || 0);
        const keuntungan = Number(data.summary?.total_keuntungan_bersih !== undefined ? data.summary.total_keuntungan_bersih : (totalPendapatan - totalBiaya));

        document.getElementById('card-pendapatan').innerText = formatRp(totalPendapatan);
        document.getElementById('card-biaya').innerText = formatRp(totalBiaya);
        document.getElementById('card-keuntungan').innerText = formatRp(keuntungan);

        renderStatusArmadaWidget(listMobil);
        renderCharts(data.detail_unit || [], data.summary || {}, data.trend_harian || {});
      } catch (e) {
        console.error('Error loading dashboard:', e);
      }
    }

    function switchDashboardToBulanIni() {
      onGlobalFilterChange('dashboard', 'bulan_ini');
    }

    async function openModalRiwayatArsip() {
      const modal = document.getElementById('modal-riwayat-arsip');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      await renderTableRiwayatArsip();
    }

    function closeModalRiwayatArsip() {
      const modal = document.getElementById('modal-riwayat-arsip');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    async function renderTableRiwayatArsip() {
      const tbody = document.getElementById('table-riwayat-arsip-body');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-400">Memuat data arsip...</td></tr>';

      try {
        const archives = await apiFetch('/api/riwayat-bulanan');
        cachedArchivesList = archives || [];

        if (cachedArchivesList.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400 font-medium">Belum ada riwayat arsip bulanan yang ditutup buku.</td></tr>';
          return;
        }

        tbody.innerHTML = '';
        cachedArchivesList.forEach(a => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-gray-50/80 transition';
          tr.innerHTML = `
            <td class="p-2.5 font-bold text-gray-800">
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
                  <i class="fa-solid fa-calendar-check"></i>
                </span>
                <div>
                  <p class="font-extrabold text-gray-900">${a.nama_bulan} ${a.tahun}</p>
                  <p class="text-[10px] text-gray-400">Kode: ${a.periode} (${a.total_transaksi || 0} trx)</p>
                </div>
              </div>
            </td>
            <td class="p-2.5 text-right font-extrabold text-green-700">${formatRp(a.total_pendapatan)}</td>
            <td class="p-2.5 text-right font-bold text-red-600">${formatRp(a.total_biaya)}</td>
            <td class="p-2.5 text-right font-black text-indigo-700">${formatRp(a.total_keuntungan_bersih)}</td>
            <td class="p-2.5 text-center">
              <span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <i class="fa-solid fa-lock text-[9px]"></i> Closed
              </span>
            </td>
            <td class="p-2.5 text-center">
              <button onclick="pilihArsipDariTabel('${a.periode}')" class="text-xs font-bold bg-custom-green hover:bg-custom-hover text-white px-2.5 py-1 rounded-lg transition active:scale-95 shadow-2xs">
                <i class="fa-solid fa-eye mr-1"></i> Review
              </button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500 font-bold">Gagal memuat arsip: ${err.message}</td></tr>`;
      }
    }

    function pilihArsipDariTabel(periode) {
      closeModalRiwayatArsip();
      onGlobalFilterChange('modal', `archive:${periode}`);
    }

    async function triggerManualTutupBuku() {
      const confirmed = confirm('Apakah Anda yakin ingin melakukan verifikasi & tutup buku untuk siklus bulan yang telah berakhir?');
      if (!confirmed) return;

      const btn = document.getElementById('btn-manual-tutup-buku');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
      }

      try {
        const res = await apiFetch('/api/riwayat-bulanan/tutup-buku', { method: 'POST' });
        alert(res.message || 'Tutup buku berhasil dijalankan');
        await populateAllFilterDropdowns();
        await renderTableRiwayatArsip();
        await refreshAllModules();
      } catch (err) {
        alert('Gagal tutup buku: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Tutup Buku Sekarang';
        }
      }
    }

    // Real-Time Status Armada Widget
    function renderStatusArmadaWidget(dataMobil) {
      const container = document.getElementById('status-armada-container');
      if (!container) return;
      container.innerHTML = '';

      if (!dataMobil || dataMobil.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-400 col-span-4">Belum ada data armada.</p>`;
        return;
      }

      let htmlStr = '';
      dataMobil.forEach(m => {
        let statusBg = 'bg-green-50 border-green-200 text-green-700';
        let statusBadge = 'bg-green-500';
        let icon = 'fa-circle-check';

        const st = (m.status_sewa || '').toLowerCase();
        if (st === 'sewa' || st === 'disewa') {
          statusBg = 'bg-amber-50 border-amber-200 text-amber-700';
          statusBadge = 'bg-amber-500';
          icon = 'fa-car-side';
        } else if (st === 'maintenance' || st === 'servis') {
          statusBg = 'bg-red-50 border-red-200 text-red-700';
          statusBadge = 'bg-red-500';
          icon = 'fa-wrench';
        }

        htmlStr += `
          <div class="p-3 rounded-lg border ${statusBg} flex items-center justify-between">
            <div>
              <p class="font-bold text-gray-800 text-xs">${m.nama_mobil}</p>
              <p class="text-[10px] text-gray-500 font-mono">${m.plat_nomor}</p>
              ${m.tgl_kembali && m.tgl_kembali !== '-' ? `<p class="text-[9px] mt-1 text-gray-600 font-semibold"><i class="fa-solid fa-flag-checkered mr-1"></i>Selesai: <b>${m.tgl_kembali}</b></p>` : ''}
            </div>
            <div class="text-right">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold text-white ${statusBadge}">
                <i class="fa-solid ${icon}"></i> ${m.status_sewa || 'Tersedia'}
              </span>
            </div>
          </div>
        `;
      });
      container.innerHTML = htmlStr;
    }

    // Render Chart.js dengan Akurasi Skema Bagi Hasil 70:30
    function renderCharts(details, summary, trendHarian) {
      if (typeof Chart === 'undefined') {
        console.warn('Chart.js belum dimuat atau gagal dimuat dari CDN.');
        return;
      }
      const labelsBar = (details || []).map(d => d.nama_mobil);
      const dataPendapatanBar = (details || []).map(d => d.total_pendapatan || 0);

      const totPendapatan = Number(summary?.total_pendapatan || 0);
      const totBiaya = Number(summary?.total_biaya || 0);

      // Line Chart Real Harian
      const lineLabels = (trendHarian && trendHarian.labels && trendHarian.labels.length) ? trendHarian.labels : ['Hari Ini'];
      const linePend = (trendHarian && trendHarian.pendapatan && trendHarian.pendapatan.length) ? trendHarian.pendapatan : [totPendapatan];
      const lineBiaya = (trendHarian && trendHarian.biaya && trendHarian.biaya.length) ? trendHarian.biaya : [totBiaya];

      if (lineChart) lineChart.destroy();
      const ctxLine = document.getElementById('lineChartHarian');
      if (ctxLine) {
        lineChart = new Chart(ctxLine, {
          type: 'line',
          data: {
            labels: lineLabels,
            datasets: [
              { label: 'Pendapatan', data: linePend, borderColor: '#0F4C25', backgroundColor: 'rgba(15,76,37,0.1)', tension: 0.3, fill: true },
              { label: 'Biaya Ops', data: lineBiaya, borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.3, fill: true }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return `${context.dataset.label}: ${formatRp(context.raw)}`;
                  }
                }
              }
            }
          }
        });
      }

      // Bar Chart Pendapatan per Unit
      if (barChart) barChart.destroy();
      const ctxBar = document.getElementById('barChart');
      if (ctxBar) {
        barChart = new Chart(ctxBar, {
          type: 'bar',
          data: {
            labels: labelsBar,
            datasets: [{ label: 'Omset per Mobil', data: dataPendapatanBar, backgroundColor: '#16A34A', borderRadius: 4 }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return `Omset: ${formatRp(context.raw)}`;
                  }
                }
              }
            }
          }
        });
      }

      // Doughnut Chart Bagi Hasil (Porsi JRC Trans vs Hak Mitra Investor)
      const porsiPengelola = Number(summary?.total_porsi_pengelola || 0);
      const porsiInvestor = Number(summary?.total_porsi_investor || 0);

      if (pieChart) pieChart.destroy();
      const ctxPie = document.getElementById('pieChart');
      if (ctxPie) {
        pieChart = new Chart(ctxPie, {
          type: 'doughnut',
          data: {
            labels: ['Porsi JRC Trans (30% + Unit Sendiri)', 'Hak Mitra Investor (70% - Ops)'],
            datasets: [{
              data: [porsiPengelola, porsiInvestor],
              backgroundColor: ['#0F4C25', '#8B5CF6']
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const val = Number(context.raw) || 0;
                    const total = porsiPengelola + porsiInvestor;
                    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                    return `${context.label}: ${formatRp(val)} (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      }
    }

    // =========================================================================
    // MODUL 2: KELOLA ARMADA
    // =========================================================================
    async function loadArmada() {
      try {
        const list = window.AppState.data.mobil;
        if (!list) return;
        const tbody = document.getElementById('tabel-armada');
        const role = localStorage.getItem('JRC_role');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!list || list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-400">Belum ada data armada.</td></tr>`;
          return;
        }

        let htmlStr = '';
        list.forEach(m => {
          const isInv = (m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
          let badgeStatus = 'bg-green-100 text-green-700 border-green-300';
          let statusLabel = m.status_sewa || 'Tersedia';

          if (statusLabel === 'Sewa' || statusLabel === 'Disewa') {
            badgeStatus = 'bg-amber-100 text-amber-700 border-amber-300';
          } else if (statusLabel === 'Maintenance' || statusLabel === 'Servis') {
            badgeStatus = 'bg-red-100 text-red-700 border-red-300';
          }

          const actionHtml = role === 'admin' ? `
            <button onclick="openEditMobil(${m.id})" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="Edit Armada"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deleteMobil(${m.id})" class="p-1.5 text-red-600 hover:bg-red-50 rounded transition" title="Hapus Armada"><i class="fa-solid fa-trash"></i></button>
          ` : `<span class="text-xs text-gray-400 italic">Read-only</span>`;

          const statusDropdownHtml = role === 'admin' ? `
            <select onchange="updateStatusMobil(${m.id}, this.value)" class="text-xs border rounded px-2 py-1 font-bold ${badgeStatus} focus:outline-none">
              <option value="Tersedia" ${statusLabel === 'Tersedia' ? 'selected' : ''}>🟢 Tersedia</option>
              <option value="Disewa" ${statusLabel === 'Sewa' || statusLabel === 'Disewa' ? 'selected' : ''}>🟡 Disewa</option>
              <option value="Maintenance" ${statusLabel === 'Maintenance' || statusLabel === 'Servis' ? 'selected' : ''}>🔴 Maintenance</option>
            </select>
          ` : `
            <span class="px-2 py-1 rounded text-xs font-bold ${badgeStatus}">
              ${statusLabel}
            </span>
          `;

          htmlStr += `
            <tr class="hover:bg-gray-50 border-b border-gray-100">
              <td class="p-3 font-bold text-gray-800">${m.nama_mobil}</td>
              <td class="p-3 font-mono text-gray-600">${m.plat_nomor}</td>
              <td class="p-3">${m.tahun}</td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isInv ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
                  ${isInv ? 'Investor' : 'JRC Trans'}
                </span>
              </td>
              <td class="p-3">${statusDropdownHtml}</td>
              <td class="p-3 text-xs text-gray-600">${m.tgl_kembali || '-'}</td>
              <td class="p-3 text-center space-x-1">${actionHtml}</td>
            </tr>
          `;
        });
        tbody.innerHTML = htmlStr;
      } catch (e) {
        console.error('Error load armada:', e);
      }
    }

    async function simpanArmada(e) {
      if (e) {
        try { e.preventDefault(); } catch(_) {}
      }
      const namaEl = document.getElementById('add-nama-mobil');
      const platEl = document.getElementById('add-plat-nomor');
      const tahunEl = document.getElementById('add-tahun');
      const kepEl = document.getElementById('add-kepemilikan');

      const namaVal = namaEl ? (namaEl.value || '').trim() : '';
      const platVal = platEl ? (platEl.value || '').trim() : '';
      const tahunVal = tahunEl ? (parseInt(tahunEl.value) || 2025) : 2025;
      const kepVal = kepEl ? (kepEl.value || 'Investor') : 'Investor';

      if (!namaVal || !platVal) {
        alert('Mohon lengkapi Nama Mobil dan Plat Nomor!');
        return false;
      }

      const btn = document.getElementById('btn-simpan-mobil');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Menyimpan...';
      }

      const body = {
        nama_mobil: namaVal,
        plat_nomor: platVal,
        tahun: tahunVal,
        kepemilikan: kepVal
      };

      try {
        const res = await apiFetch('/api/mobil', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        closeModalArmada();
        if (namaEl) namaEl.value = '';
        if (platEl) platEl.value = '';
        await refreshAllModules();
        alert(res.message || 'Armada mobil berhasil ditambahkan!');
      } catch (err) {
        alert('Gagal menyimpan armada: ' + (err.message || err));
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Simpan Mobil';
        }
      }
      return false;
    }

    async function openEditMobil(id) {
      try {
        const list = await apiFetch('/api/mobil');
        const mobil = list.find(m => Number(m.id) === Number(id));
        if (!mobil) return;

        document.getElementById('edit-armada-id').value = mobil.id;
        document.getElementById('edit-armada-nama').value = mobil.nama_mobil;
        document.getElementById('edit-armada-plat').value = mobil.plat_nomor;
        document.getElementById('edit-armada-tahun').value = mobil.tahun;
        document.getElementById('edit-armada-kepemilikan').value = (mobil.kepemilikan && mobil.kepemilikan.toLowerCase().includes('investor')) ? 'Investor' : 'JRC Trans';

        document.getElementById('modal-edit-armada').classList.remove('hidden');
        document.getElementById('modal-edit-armada').classList.add('flex');
      } catch (e) {
        console.error(e);
      }
    }

    function closeModalEditArmada() {
      document.getElementById('modal-edit-armada').classList.add('hidden');
      document.getElementById('modal-edit-armada').classList.remove('flex');
    }

    async function simpanEditArmada(e) {
      e.preventDefault();
      const id = document.getElementById('edit-armada-id').value;
      const body = {
        nama_mobil: document.getElementById('edit-armada-nama').value,
        plat_nomor: document.getElementById('edit-armada-plat').value,
        tahun: document.getElementById('edit-armada-tahun').value,
        kepemilikan: document.getElementById('edit-armada-kepemilikan').value
      };

      try {
        await apiFetch(`/api/mobil/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        closeModalEditArmada();
        await refreshAllModules();
        alert('Data armada berhasil diperbarui!');
      } catch (err) {
        alert(err.message);
      }
    }

    async function updateStatusMobil(id, status_sewa) {
      let tgl_kembali = '-';
      const stLower = (status_sewa || '').toLowerCase();
      if (stLower === 'sewa' || stLower === 'disewa') {
        const inputTgl = prompt('Masukkan estimasi tanggal kembali rental (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
        if (inputTgl) tgl_kembali = inputTgl;
      } else if (stLower === 'maintenance' || stLower === 'servis') {
        const inputTgl = prompt('Masukkan estimasi tanggal selesai servis (YYYY-MM-DD) atau biarkan kosong:', '');
        if (inputTgl) tgl_kembali = inputTgl;
      } else {
        // Status Tersedia: tanggal kembali otomatis dibersihkan
        tgl_kembali = '-';
      }

      try {
        await apiFetch(`/api/mobil/${id}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status_sewa, tgl_kembali })
        });
        await refreshAllModules();
      } catch (e) {
        alert('Gagal mengubah status armada: ' + (e.message || e));
      }
    }

    async function deleteMobil(id) {
      if (!confirm('Yakin ingin menghapus armada ini? Riwayat transaksi unit terkait juga akan dibersihkan.')) return;
      try {
        await apiFetch(`/api/mobil/${id}`, { method: 'DELETE' });
        await refreshAllModules();
        alert('Armada berhasil dihapus!');
      } catch (e) {
        alert('Gagal menghapus armada: ' + (e.message || e));
      }
    }

    // =========================================================================
    // MODUL 3: INPUT TRANSAKSI
    // =========================================================================
    async function loadTransaksi() {
      try {
        let query = `?filter=${globalActiveFilter}`;
        if (globalActiveFilter === 'custom' && globalStartDate && globalEndDate) {
          query += `&start=${globalStartDate}&end=${globalEndDate}`;
        }

        const list = window.AppState.data.transaksi;
        if (!list) return;
        if (Array.isArray(list)) {
          list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || (b.id - a.id));
        }
        cachedTransaksiList = list || [];
        const tbody = document.getElementById('tabel-transaksi');
        const role = localStorage.getItem('JRC_role');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Status banner & badge
        const isArchived = globalActiveFilter.startsWith('archive:') || globalActiveFilter.startsWith('bulan:');
        const banner = document.getElementById('transaksi-archive-banner');
        const badge = document.getElementById('transaksi-period-badge');

        if (isArchived) {
          const ym = globalActiveFilter.replace(/^(archive:|bulan:)/, '').trim();
          const arc = (cachedArchivesList || []).find(a => a.periode === ym);
          const periodName = arc ? `${arc.nama_bulan} ${arc.tahun}` : ym;

          if (banner) {
            banner.classList.remove('hidden');
            banner.classList.add('flex');
            const txt = document.getElementById('transaksi-archive-banner-text');
            if (txt) {
              txt.innerText = `Menampilkan catatan transaksi resmi periode ${periodName} (Tutup Buku).`;
            }
          }
          if (badge) {
            badge.className = 'inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 rounded-full border border-amber-300 shadow-2xs';
            badge.innerHTML = `<i class="fa-solid fa-lock text-amber-700"></i> Arsip: <b id="transaksi-period-label">${periodName}</b>`;
          }
        } else {
          if (banner) {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
          }
          if (badge) {
            badge.className = 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 rounded-full border border-emerald-200 shadow-2xs';
            const labelText = globalActiveFilter === 'bulan_ini' ? 'Bulan Ini (Siklus Baru)' : (globalActiveFilter === 'hari_ini' ? 'Hari Ini' : (globalActiveFilter === '7_hari' ? '7 Hari Terakhir' : (globalActiveFilter === 'custom' ? `${globalStartDate} s/d ${globalEndDate}` : 'Semua Transaksi')));
            badge.innerHTML = `<i class="fa-solid fa-calendar-check text-emerald-600"></i> Siklus: <b id="transaksi-period-label">${labelText}</b>`;
          }
        }

        if (!list || list.length === 0) {
          const emptyMsg = globalActiveFilter === 'bulan_ini'
            ? 'Belum ada transaksi di bulan ini (Siklus Baru). Silakan klik <b>+ Input Transaksi Baru</b> untuk memulai pencatatan bulan ini.'
            : 'Belum ada data transaksi pada periode ini.';
          tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400 font-medium">${emptyMsg}</td></tr>`;
          return;
        }

        list.forEach(t => {
          const tarifVal = Number(t.tarif_sewa || t.tarif || 0);
          const totalOps = (Number(t.biaya_bbm) || 0) + (Number(t.biaya_servis) || 0) + (Number(t.biaya_lainnya) || 0);
          const tglKembaliInfo = (t.tgl_kembali && t.tgl_kembali !== t.tanggal) ? `<br><span class="text-[10px] text-gray-500 font-semibold"><i class="fa-solid fa-arrow-right text-[8px] mr-1"></i>s/d ${t.tgl_kembali}</span>` : '';
          const archiveTag = isArchived ? `<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-bold px-1.5 py-0.5 rounded ml-1"><i class="fa-solid fa-lock text-[8px]"></i> Arsip</span>` : '';

          tbody.innerHTML += `
            <tr class="hover:bg-gray-50 border-b border-gray-100">
              <td class="p-3 font-medium text-gray-700 whitespace-nowrap">${t.tanggal}${tglKembaliInfo}${archiveTag}</td>
              <td class="p-3">
                <span class="font-bold text-gray-800">${t.nama_mobil || '-'}</span><br>
                <span class="text-gray-500 font-mono text-[10px]">${t.plat_nomor || '-'}</span>
              </td>
              <td class="p-3 font-semibold text-gray-800">${t.penyewa || '-'}</td>
              <td class="p-3 font-semibold text-green-700 whitespace-nowrap">${formatRp(tarifVal)}</td>
              <td class="p-3 font-semibold text-red-600 whitespace-nowrap">${formatRp(totalOps)}</td>
              <td class="p-3 text-xs text-gray-600">${t.keterangan || '-'}</td>
              <td class="p-3 text-center space-x-1 whitespace-nowrap">
                ${role === 'admin' ? `
                  <button onclick="openEditTransaksi(${t.id})" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="Edit Transaksi"><i class="fa-solid fa-pen-to-square"></i></button>
                  <button onclick="deleteTransaksi(${t.id})" class="p-1.5 text-red-600 hover:bg-red-50 rounded transition" title="Hapus Transaksi"><i class="fa-solid fa-trash"></i></button>
                ` : `<span class="text-xs text-gray-400 italic">Read-only</span>`}
              </td>
            </tr>
          `;
        });
      } catch (e) {
        console.error('Error load transaksi:', e);
      }
    }

    function switchTransaksiToBulanIni() {
      onGlobalFilterChange('transaksi', 'bulan_ini');
    }

    async function simpanTransaksi(e) {
      e.preventDefault();
      const body = {
        mobil_id: document.getElementById('trx-mobil-id').value,
        tanggal: document.getElementById('trx-tanggal').value,
        tgl_mulai: document.getElementById('trx-tanggal').value,
        tgl_kembali: document.getElementById('trx-tgl-kembali').value || document.getElementById('trx-tanggal').value,
        penyewa: document.getElementById('trx-penyewa').value,
        tarif_sewa: Number(document.getElementById('trx-tarif').value) || 0,
        biaya_bbm: Number(document.getElementById('trx-bbm').value) || 0,
        biaya_servis: Number(document.getElementById('trx-servis').value) || 0,
        biaya_lainnya: Number(document.getElementById('trx-lainnya').value) || 0,
        keterangan: document.getElementById('trx-keterangan').value
      };

      try {
        await apiFetch('/api/transaksi', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        closeModalTransaksi();
        e.target.reset();
        document.getElementById('trx-tanggal').valueAsDate = new Date();
        document.getElementById('trx-tgl-kembali').valueAsDate = new Date();
        await refreshAllModules();
        alert('Transaksi berhasil disimpan & status armada diperbarui secara otomatis!');
      } catch (err) {
        alert(err.message);
      }
    }

    async function simpanEditTransaksi(e) {
      e.preventDefault();
      const id = document.getElementById('edit-trx-id').value;
      const body = {
        mobil_id: document.getElementById('edit-trx-mobil-id').value,
        tanggal: document.getElementById('edit-trx-tanggal').value,
        tgl_kembali: document.getElementById('edit-trx-tgl-kembali').value || document.getElementById('edit-trx-tanggal').value,
        penyewa: document.getElementById('edit-trx-penyewa').value,
        tarif_sewa: Number(document.getElementById('edit-trx-tarif').value) || 0,
        biaya_bbm: Number(document.getElementById('edit-trx-bbm').value) || 0,
        biaya_servis: Number(document.getElementById('edit-trx-servis').value) || 0,
        biaya_lainnya: Number(document.getElementById('edit-trx-lainnya').value) || 0,
        keterangan: document.getElementById('edit-trx-keterangan').value
      };

      try {
        await apiFetch(`/api/transaksi/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        closeModalEditTransaksi();
        await refreshAllModules();
        alert('Transaksi berhasil diperbarui!');
      } catch (err) {
        alert(err.message);
      }
    }

    async function deleteTransaksi(id) {
      if (!confirm('Yakin ingin menghapus transaksi ini?')) return;
      try {
        await apiFetch(`/api/transaksi/${id}`, { method: 'DELETE' });
        await refreshAllModules();
        alert('Transaksi berhasil dihapus!');
      } catch (e) {
        alert('Gagal menghapus transaksi');
      }
    }

    // =========================================================================
    // MODUL 4: REPORT INVESTOR
    // =========================================================================
    async function populateReportMobilDropdown() {
      try {
        const mobilList = await apiFetch('/api/mobil');
        const select = document.getElementById('report-filter-mobil');
        if (!select) return;
        const currentVal = select.value;
        const invMobil = (mobilList || []).filter(m => m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
        
        select.innerHTML = '<option value="all">🚗 Semua Unit Investor</option>';
        invMobil.forEach(m => {
          select.innerHTML += `<option value="${m.id}">🚗 ${m.nama_mobil} (${m.plat_nomor})</option>`;
        });
        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
          select.value = currentVal;
        }
      } catch (e) {
        console.error('Error populating report mobil dropdown:', e);
      }
    }

    async function loadReport() {
      const mobilId = document.getElementById('report-filter-mobil')?.value || 'all';
      let query = `?filter=${globalActiveFilter}`;
      if (mobilId && mobilId !== 'all') {
        query += `&mobil_id=${mobilId}`;
      }

      let labelPeriod = 'Semua Waktu';
      if (globalActiveFilter === 'hari_ini') labelPeriod = 'Hari Ini';
      else if (globalActiveFilter === '7_hari') labelPeriod = '7 Hari Terakhir';
      else if (globalActiveFilter === 'bulan_ini') labelPeriod = 'Bulan Ini (Siklus Berjalan)';
      else if (globalActiveFilter.startsWith('archive:')) {
        const ym = globalActiveFilter.replace('archive:', '');
        const arc = (cachedArchivesList || []).find(a => a.periode === ym);
        labelPeriod = arc ? `${arc.nama_bulan} ${arc.tahun} (Tutup Buku)` : ym;
      } else if (globalActiveFilter === 'custom') {
        if (globalStartDate && globalEndDate) {
          query += `&start=${globalStartDate}&end=${globalEndDate}`;
          labelPeriod = `${globalStartDate} s/d ${globalEndDate}`;
        }
      }

      const pLabel = document.getElementById('report-period-label');
      if (pLabel) pLabel.innerText = labelPeriod;
      const dStamp = document.getElementById('report-date-stamp');
      if (dStamp) dStamp.innerText = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      try {
        const data = window.AppState.data.investor;
        if (!data) return;
        const container = document.getElementById('report-investor-content');
        if (!container) return;
        container.innerHTML = '';

        const list = Array.isArray(data) ? data : (data.detail_unit || []);
        const summary = data.summary || {
          total_pendapatan: 0,
          total_biaya: 0,
          total_bbm: 0,
          total_servis: 0,
          total_lainnya: 0,
          total_porsi_pengelola: 0,
          total_hak_investor: 0
        };

        if (!list || list.length === 0) {
          container.innerHTML = `
            <div class="p-12 text-center text-gray-400 font-medium bg-gray-50 rounded-xl border border-dashed border-gray-300">
              <i class="fa-solid fa-inbox text-3xl mb-2 text-gray-300 block"></i>
              Tidak ada transaksi armada investor yang tercatat untuk periode ${labelPeriod}.
            </div>
          `;
          return;
        }

        // 1. BANNER RINGKASAN GLOBAL INVESTOR
        let html = `
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl shadow-xs">
              <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Total Omset Sewa</p>
              <h3 class="text-base md:text-lg font-black text-emerald-900 mt-1">${formatRp(summary.total_pendapatan)}</h3>
              <p class="text-[10px] text-emerald-600 mt-0.5">${list.length} Unit Armada Aktif</p>
            </div>

            <div class="bg-rose-50 border border-rose-200 p-3.5 rounded-xl shadow-xs">
              <p class="text-[10px] font-bold uppercase tracking-wider text-rose-700">Total Biaya Operasional</p>
              <h3 class="text-base md:text-lg font-black text-rose-900 mt-1">${formatRp(summary.total_biaya)}</h3>
              <p class="text-[9px] text-rose-600 mt-0.5">BBM: ${formatRp(summary.total_bbm)} | Servis: ${formatRp(summary.total_servis)}</p>
            </div>

            <div class="bg-blue-50 border border-blue-200 p-3.5 rounded-xl shadow-xs">
              <p class="text-[10px] font-bold uppercase tracking-wider text-blue-700">Hak Pengelola JRC Trans</p>
              <h3 class="text-base md:text-lg font-black text-blue-900 mt-1">${formatRp(summary.total_porsi_pengelola)}</h3>
              <p class="text-[10px] text-blue-600 mt-0.5">30% Gross dari Total Sewa</p>
            </div>

            <div class="bg-purple-50 border-2 border-purple-300 p-3.5 rounded-xl shadow-xs">
              <p class="text-[10px] font-black uppercase tracking-wider text-purple-800">Total Hak Bersih Investor</p>
              <h3 class="text-base md:text-xl font-black text-purple-900 mt-1">${formatRp(summary.total_hak_investor)}</h3>
              <p class="text-[10px] text-purple-700 font-bold mt-0.5">70% Gross - Biaya Operasional</p>
            </div>
          </div>
        `;

        // 2. RINCIAN PER UNIT MOBIL (MASTER-DETAIL)
        list.forEach((d, unitIdx) => {
          const totPend = Number(d.total_pendapatan) || 0;
          const bbm = Number(d.biaya_bbm) || 0;
          const servis = Number(d.biaya_servis) || 0;
          const lainnya = Number(d.biaya_lainnya) || 0;
          const totBiaya = Number(d.total_biaya) || (bbm + servis + lainnya);
          
          const porsiPengelola = Number(d.porsi_pengelola_30 !== undefined ? d.porsi_pengelola_30 : (totPend * 0.30));
          const hakKotor70 = Number(d.hak_investor_kotor_70 !== undefined ? d.hak_investor_kotor_70 : (totPend * 0.70));
          const hakBersihInv = Number(d.hak_investor_70 !== undefined ? d.hak_investor_70 : (hakKotor70 - totBiaya));

          const txList = d.riwayat_transaksi || [];

          html += `
            <div class="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white mt-4">
              <!-- Header Unit Mobil -->
              <div class="bg-gray-100/80 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="w-7 h-7 rounded-lg bg-purple-700 text-white flex items-center justify-center font-black text-xs">${unitIdx + 1}</span>
                  <div>
                    <h3 class="font-black text-gray-800 text-sm md:text-base flex items-center gap-2">
                      ${d.nama_mobil}
                      <span class="text-xs font-mono font-bold bg-white text-gray-700 px-2 py-0.5 rounded border border-gray-300">${d.plat_nomor}</span>
                    </h3>
                    <p class="text-[10px] text-gray-500 font-medium">Tahun Pembuatan: ${d.tahun || '-'} | Status: <span class="font-bold text-purple-700">Mitra Investor</span></p>
                  </div>
                </div>
                <div class="text-right">
                  <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2.5 py-1 rounded-full border border-purple-200">
                    <i class="fa-solid fa-car-side mr-1"></i> ${txList.length}x Perjalanan Rental
                  </span>
                </div>
              </div>

              <!-- Tabel Rincian Transaksi Tanggal per Tanggal -->
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr class="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                      <th class="p-2.5 text-center w-10">No</th>
                      <th class="p-2.5 w-24">Tanggal</th>
                      <th class="p-2.5 w-32">Penyewa</th>
                      <th class="p-2.5 text-right w-28 text-emerald-800">Tarif Sewa</th>
                      <th class="p-2.5 text-right w-24 text-red-700">BBM</th>
                      <th class="p-2.5 text-right w-28 text-orange-700">Servis / Oli</th>
                      <th class="p-2.5 text-right w-24 text-gray-700">Lainnya</th>
                      <th class="p-2.5">Keterangan Operasional</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
          `;

          if (txList.length === 0) {
            html += `<tr><td colspan="8" class="p-4 text-center text-gray-400 font-medium">Tidak ada rincian transaksi sewa pada periode ${labelPeriod}.</td></tr>`;
          } else {
            txList.forEach((tx, txIdx) => {
              const txTarif = Number(tx.tarif_sewa !== undefined ? tx.tarif_sewa : tx.tarif) || 0;
              const txBbm = Number(tx.biaya_bbm) || 0;
              const txServis = Number(tx.biaya_servis) || 0;
              const txLain = Number(tx.biaya_lainnya) || 0;

              html += `
                <tr class="hover:bg-gray-50 transition">
                  <td class="p-2.5 text-center font-bold text-gray-400">${txIdx + 1}</td>
                  <td class="p-2.5 font-medium text-gray-700 whitespace-nowrap">${tx.tanggal || '-'}</td>
                  <td class="p-2.5 font-bold text-gray-800">${tx.penyewa || '-'}</td>
                  <td class="p-2.5 text-right font-bold text-emerald-700">${formatRp(txTarif)}</td>
                  <td class="p-2.5 text-right font-semibold ${txBbm > 0 ? 'text-red-600' : 'text-gray-400'}">${formatRp(txBbm)}</td>
                  <td class="p-2.5 text-right font-semibold ${txServis > 0 ? 'text-orange-600 font-bold' : 'text-gray-400'}">${formatRp(txServis)}</td>
                  <td class="p-2.5 text-right font-semibold ${txLain > 0 ? 'text-gray-700' : 'text-gray-400'}">${formatRp(txLain)}</td>
                  <td class="p-2.5 text-gray-600 italic text-[11px]">${tx.keterangan || '-'}</td>
                </tr>
              `;
            });
          }

          html += `
                  </tbody>
                </table>
              </div>

              <!-- Subtotal Rekapitulasi Finansial Unit -->
              <div class="bg-gray-50/90 p-4 border-t border-gray-200">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <div class="bg-white p-2.5 rounded-lg border border-gray-200">
                    <span class="text-gray-500 font-semibold block text-[10px] uppercase">Total Pendapatan Sewa</span>
                    <span class="text-sm font-black text-emerald-700">${formatRp(totPend)}</span>
                    <span class="text-[10px] text-gray-400 block">${txList.length}x Perjalanan</span>
                  </div>

                  <div class="bg-white p-2.5 rounded-lg border border-gray-200">
                    <span class="text-gray-500 font-semibold block text-[10px] uppercase">Total Pengeluaran Ops</span>
                    <span class="text-sm font-black text-rose-700">${formatRp(totBiaya)}</span>
                    <span class="text-[9px] text-gray-500 block">BBM: ${formatRp(bbm)} | Servis: ${formatRp(servis)}</span>
                  </div>

                  <div class="bg-white p-2.5 rounded-lg border border-gray-200">
                    <span class="text-gray-500 font-semibold block text-[10px] uppercase">Porsi JRC Trans (30% Gross)</span>
                    <span class="text-sm font-black text-blue-700">${formatRp(porsiPengelola)}</span>
                    <span class="text-[10px] text-gray-400 block">Komisi Pengelolaan</span>
                  </div>

                  <div class="bg-purple-100/70 p-2.5 rounded-lg border border-purple-300">
                    <span class="text-purple-900 font-black block text-[10px] uppercase">Hak Bersih Diterima Investor</span>
                    <span class="text-base font-black text-purple-900">${formatRp(hakBersihInv)}</span>
                    <span class="text-[10px] text-purple-700 font-semibold block">(${formatRp(hakKotor70)} - ${formatRp(totBiaya)})</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        });

        container.innerHTML = html;
      } catch (e) {
        console.error('Error load report investor:', e);
      }
    }

    function downloadPDFReport() {
      if (typeof html2pdf === 'undefined') {
        alert('Library html2pdf belum dimuat dari CDN. Pastikan koneksi internet aktif.');
        return;
      }
      const element = document.getElementById('pdf-container');
      if (!element) {
        alert('Konten laporan tidak ditemukan!');
        return;
      }
      const opt = {
        margin:       0.5,
        filename:     `Laporan_Investor_JRCTrans_${new Date().toISOString().split('T')[0]}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
      };
      html2pdf().from(element).set(opt).save();
    }

    // =========================================================================
    // MODUL 5: ALL REPORT (KHUSUS ADMIN)
    // =========================================================================
    async function populateAllReportMobilDropdown() {
      try {
        const mobilList = await apiFetch('/api/mobil');
        const select = document.getElementById('allreport-filter-mobil');
        if (!select) return;
        const currentVal = select.value || 'all';

        let filteredCars = mobilList || [];
        let defaultLabel = '🚗 Semua Unit Armada';

        if (currentAllReportCategory === 'investor') {
          filteredCars = filteredCars.filter(m => m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor'));
          defaultLabel = '🚗 Semua Unit Investor';
        } else if (currentAllReportCategory === 'sendiri') {
          filteredCars = filteredCars.filter(m => !(m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor')));
          defaultLabel = '🚗 Semua Unit Milik JRC Trans';
        }

        let optionsHtml = `<option value="all">${defaultLabel}</option>`;
        filteredCars.forEach(m => {
          const isInv = m.kepemilikan && m.kepemilikan.toLowerCase().includes('investor');
          const tag = currentAllReportCategory === 'all' ? (isInv ? '[Investor] ' : '[Sendiri] ') : '';
          optionsHtml += `<option value="${m.id}">🚗 ${tag}${m.nama_mobil} (${m.plat_nomor})</option>`;
        });
        select.innerHTML = optionsHtml;

        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
          select.value = currentVal;
        } else {
          select.value = 'all';
        }
      } catch (e) {
        console.error('Error populating all report mobil dropdown:', e);
      }
    }

    async function setAllReportUnitCategory(cat) {
      currentAllReportCategory = cat;
      ['all', 'investor', 'sendiri'].forEach(c => {
        const btn = document.getElementById(`btn-unit-${c}`);
        if (!btn) return;
        if (c === cat) {
          btn.className = 'px-3 py-1.5 rounded-md transition bg-custom-green text-white shadow-xs';
        } else {
          btn.className = 'px-3 py-1.5 rounded-md transition text-gray-600 hover:text-custom-green';
        }
      });
      await populateAllReportMobilDropdown();
      loadAllReport();
    }

    async function loadAllReport() {
      const role = localStorage.getItem('JRC_role');
      if (role === 'investor') return;

      const mobilSelect = document.getElementById('allreport-filter-mobil');
      const mobilId = mobilSelect ? (mobilSelect.value || 'all') : 'all';

      let query = `?filter=${globalActiveFilter}&kategori_unit=${currentAllReportCategory}`;
      if (mobilId && mobilId !== 'all') {
        query += `&mobil_id=${mobilId}`;
      }

      let labelPeriod = 'Semua Waktu';
      if (globalActiveFilter === 'hari_ini') labelPeriod = 'Hari Ini';
      else if (globalActiveFilter === '7_hari') labelPeriod = '7 Hari Terakhir';
      else if (globalActiveFilter === 'bulan_ini') labelPeriod = 'Bulan Ini (Siklus Berjalan)';
      else if (globalActiveFilter.startsWith('archive:')) {
        const ym = globalActiveFilter.replace('archive:', '');
        const arc = (cachedArchivesList || []).find(a => a.periode === ym);
        labelPeriod = arc ? `${arc.nama_bulan} ${arc.tahun} (Tutup Buku)` : ym;
      } else if (globalActiveFilter === 'custom') {
        if (globalStartDate && globalEndDate) {
          query += `&start=${globalStartDate}&end=${globalEndDate}`;
          labelPeriod = `${globalStartDate} s/d ${globalEndDate}`;
        }
      }

      const pLabel = document.getElementById('allreport-period-label');
      if (pLabel) pLabel.innerText = labelPeriod;
      const dStamp = document.getElementById('allreport-date-stamp');
      if (dStamp) dStamp.innerText = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      let catLabel = currentAllReportCategory === 'investor' 
        ? 'Unit Investor (70:30)' 
        : (currentAllReportCategory === 'sendiri' ? 'Unit Milik JRC Trans' : 'Semua Unit');

      if (mobilId !== 'all' && mobilSelect) {
        const selectedText = mobilSelect.options[mobilSelect.selectedIndex]?.text?.replace('🚗', '').trim();
        if (selectedText) catLabel += ` - ${selectedText}`;
      }

      const catEl = document.getElementById('allreport-category-label');
      if (catEl) catEl.innerText = catLabel;

      const subTitleEl = document.getElementById('allreport-pdf-subtitle');
      if (subTitleEl) {
        if (currentAllReportCategory === 'investor') {
          subTitleEl.innerText = 'Laporan Khusus Pengelolaan Unit Armada Investor (Skema 70% Investor : 30% JRC Trans)';
        } else if (currentAllReportCategory === 'sendiri') {
          subTitleEl.innerText = 'Laporan Khusus Pengelolaan Unit Milik Sendiri JRC Trans (100% Kas Bersih)';
        } else {
          subTitleEl.innerText = 'Laporan Keuangan & Rekapitulasi Operasional Seluruh Armada Rental';
        }
      }

      const btnDl = document.getElementById('btn-download-allreport');
      if (btnDl) {
        if (currentAllReportCategory === 'investor') {
          btnDl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF Laporan Investor';
        } else if (currentAllReportCategory === 'sendiri') {
          btnDl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF Unit Milik Sendiri';
        } else {
          btnDl.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF All Report';
        }
      }

      // Sesuaikan label kartu summary
      const lblPend = document.getElementById('lbl-allreport-pendapatan');
      const lblBiaya = document.getElementById('lbl-allreport-biaya');
      const lblLaba = document.getElementById('lbl-allreport-laba');
      const lblPeng = document.getElementById('lbl-allreport-pengelola');

      if (currentAllReportCategory === 'investor') {
        if (lblPend) lblPend.innerText = 'Total Omset Sewa Investor';
        if (lblBiaya) lblBiaya.innerText = 'Total Biaya Ops Investor';
        if (lblLaba) lblLaba.innerText = 'Hak Bersih Investor (70% - Ops)';
        if (lblPeng) lblPeng.innerText = 'Porsi JRC Trans (30% Gross)';
      } else if (currentAllReportCategory === 'sendiri') {
        if (lblPend) lblPend.innerText = 'Total Omset Unit Sendiri';
        if (lblBiaya) lblBiaya.innerText = 'Total Biaya Ops Unit Sendiri';
        if (lblLaba) lblLaba.innerText = 'Laba Bersih Operasional';
        if (lblPeng) lblPeng.innerText = 'Kas Bersih JRC Trans (100%)';
      } else {
        if (lblPend) lblPend.innerText = 'Total Omset Semua Unit';
        if (lblBiaya) lblBiaya.innerText = 'Total Biaya Operasional';
        if (lblLaba) lblLaba.innerText = 'Keuntungan Bersih Total';
        if (lblPeng) lblPeng.innerText = 'Hak Bersih JRC Trans';
      }

      try {
        const data = await apiFetch('/api/laporan/keseluruhan' + query);
        if (!data) return;
        const tbody = document.getElementById('tabel-all-report');
        if (!tbody) return;
        tbody.innerHTML = '';

        document.getElementById('allreport-summary-pendapatan').innerText = formatRp(data.summary?.total_pendapatan || 0);
        document.getElementById('allreport-summary-biaya').innerText = formatRp(data.summary?.total_biaya || 0);
        
        if (currentAllReportCategory === 'investor') {
          document.getElementById('allreport-summary-laba').innerText = formatRp(data.summary?.total_porsi_investor || 0);
          document.getElementById('allreport-summary-pengelola').innerText = formatRp(data.summary?.total_porsi_pengelola || 0);
        } else {
          document.getElementById('allreport-summary-laba').innerText = formatRp(data.summary?.total_laba_bersih || 0);
          document.getElementById('allreport-summary-pengelola').innerText = formatRp(data.summary?.total_porsi_pengelola || 0);
        }

        const list = data.detail_unit || [];
        const tfoot = document.getElementById('tfoot-all-report');
        const thead = document.getElementById('allreport-thead');

        if (thead) {
          if (currentAllReportCategory === 'sendiri') {
            thead.innerHTML = `
              <tr class="bg-gray-100 text-gray-700 font-bold border-y border-gray-300">
                <th class="p-2.5">Armada / Plat</th>
                <th class="p-2.5">Tahun</th>
                <th class="p-2.5 text-center">Transaksi</th>
                <th class="p-2.5 text-right">Pendapatan</th>
                <th class="p-2.5 text-right">Biaya Ops</th>
                <th class="p-2.5 text-right">Laba Bersih Kas JRC Trans (100%)</th>
              </tr>
            `;
          } else if (currentAllReportCategory === 'investor') {
            thead.innerHTML = `
              <tr class="bg-gray-100 text-gray-700 font-bold border-y border-gray-300">
                <th class="p-2.5">Armada / Plat</th>
                <th class="p-2.5 text-center">Transaksi</th>
                <th class="p-2.5 text-right">Pendapatan (Gross)</th>
                <th class="p-2.5 text-right">Biaya Ops</th>
                <th class="p-2.5 text-right">Porsi JRC Trans (30%)</th>
                <th class="p-2.5 text-right">Hak Bersih Investor (70% - Ops)</th>
              </tr>
            `;
          } else {
            thead.innerHTML = `
              <tr class="bg-gray-100 text-gray-700 font-bold border-y border-gray-300">
                <th class="p-2.5">Armada / Plat</th>
                <th class="p-2.5">Status Kepemilikan</th>
                <th class="p-2.5 text-center">Transaksi</th>
                <th class="p-2.5 text-right">Pendapatan</th>
                <th class="p-2.5 text-right">Biaya Ops</th>
                <th class="p-2.5 text-right">Laba Bersih</th>
                <th class="p-2.5 text-right">Porsi JRC Trans</th>
                <th class="p-2.5 text-right">Porsi Investor</th>
              </tr>
            `;
          }
        }

        if (list.length === 0) {
          const colSpan = (currentAllReportCategory === 'sendiri' || currentAllReportCategory === 'investor') ? 6 : 8;
          tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-6 text-center text-gray-400 font-medium"><i class="fa-solid fa-inbox text-2xl mb-2 block"></i> Tidak ada data transaksi armada pada periode ${labelPeriod}.</td></tr>`;
          if (tfoot) tfoot.innerHTML = '';
        } else {
          list.forEach(d => {
            if (currentAllReportCategory === 'sendiri') {
              tbody.innerHTML += `
                <tr class="hover:bg-gray-50 border-b border-gray-100">
                  <td class="p-2.5 font-bold text-gray-800">${d.nama_mobil} <br><span class="text-[10px] text-gray-500 font-mono">${d.plat_nomor}</span></td>
                  <td class="p-2.5 text-gray-600">${d.tahun || '-'}</td>
                  <td class="p-2.5 text-center font-bold text-gray-600">${d.total_transaksi}x</td>
                  <td class="p-2.5 text-right font-semibold text-green-700">${formatRp(d.total_pendapatan)}</td>
                  <td class="p-2.5 text-right font-semibold text-red-600">${formatRp(d.total_biaya)}</td>
                  <td class="p-2.5 text-right font-bold text-custom-green">${formatRp(d.laba_bersih)}</td>
                </tr>
              `;
            } else if (currentAllReportCategory === 'investor') {
              tbody.innerHTML += `
                <tr class="hover:bg-gray-50 border-b border-gray-100">
                  <td class="p-2.5 font-bold text-gray-800">${d.nama_mobil} <br><span class="text-[10px] text-gray-500 font-mono">${d.plat_nomor}</span></td>
                  <td class="p-2.5 text-center font-bold text-gray-600">${d.total_transaksi}x</td>
                  <td class="p-2.5 text-right font-semibold text-green-700">${formatRp(d.total_pendapatan)}</td>
                  <td class="p-2.5 text-right font-semibold text-red-600">${formatRp(d.total_biaya)}</td>
                  <td class="p-2.5 text-right font-bold text-custom-green">${formatRp(d.porsi_pengelola)}</td>
                  <td class="p-2.5 text-right font-bold text-purple-700">${formatRp(d.porsi_investor)}</td>
                </tr>
              `;
            } else {
              tbody.innerHTML += `
                <tr class="hover:bg-gray-50 border-b border-gray-100">
                  <td class="p-2.5 font-bold text-gray-800">${d.nama_mobil} <br><span class="text-[10px] text-gray-500 font-mono">${d.plat_nomor}</span></td>
                  <td class="p-2.5">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${d.is_investor ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
                      ${d.kepemilikan}
                    </span>
                  </td>
                  <td class="p-2.5 text-center font-bold text-gray-600">${d.total_transaksi}x</td>
                  <td class="p-2.5 text-right font-semibold text-green-700">${formatRp(d.total_pendapatan)}</td>
                  <td class="p-2.5 text-right font-semibold text-red-600">${formatRp(d.total_biaya)}</td>
                  <td class="p-2.5 text-right font-semibold text-indigo-700">${formatRp(d.laba_bersih)}</td>
                  <td class="p-2.5 text-right font-bold text-custom-green">${formatRp(d.porsi_pengelola)}</td>
                  <td class="p-2.5 text-right font-bold text-purple-700">${formatRp(d.porsi_investor)}</td>
                </tr>
              `;
            }
          });

          // RENDER BARIS JUMLAH TOTAL (FOOTER)
          if (tfoot) {
            const summary = data.summary || {};
            if (currentAllReportCategory === 'sendiri') {
              tfoot.innerHTML = `
                <tr class="bg-gray-100/95 text-gray-900 border-t-2 border-gray-400 text-xs">
                  <td class="p-3 font-black text-gray-900">
                    TOTAL UNIT SENDIRI
                    <br><span class="text-[10px] text-gray-500 font-bold">${list.length} Unit Armada</span>
                  </td>
                  <td class="p-3 text-center text-gray-400 font-normal">—</td>
                  <td class="p-3 text-center font-black text-gray-800 text-sm">
                    ${summary.total_transaksi || 0}x
                    <br><span class="text-[9px] text-gray-500 font-normal">Perjalanan</span>
                  </td>
                  <td class="p-3 text-right font-black text-green-800 text-sm">
                    ${formatRp(summary.total_pendapatan || 0)}
                  </td>
                  <td class="p-3 text-right font-black text-red-700 text-sm">
                    ${formatRp(summary.total_biaya || 0)}
                    <br><span class="text-[9px] text-gray-500 font-normal">BBM: ${formatRp(summary.total_bbm || 0)} | Servis: ${formatRp(summary.total_servis || 0)}</span>
                  </td>
                  <td class="p-3 text-right font-black text-custom-green text-sm bg-green-50/70">
                    ${formatRp(summary.total_laba_bersih || 0)}
                    <br><span class="text-[9px] text-custom-green font-normal">100% Kas Bersih Masuk</span>
                  </td>
                </tr>
              `;
            } else if (currentAllReportCategory === 'investor') {
              tfoot.innerHTML = `
                <tr class="bg-gray-100/95 text-gray-900 border-t-2 border-gray-400 text-xs">
                  <td class="p-3 font-black text-gray-900">
                    TOTAL UNIT INVESTOR
                    <br><span class="text-[10px] text-gray-500 font-bold">${list.length} Unit Armada</span>
                  </td>
                  <td class="p-3 text-center font-black text-gray-800 text-sm">
                    ${summary.total_transaksi || 0}x
                    <br><span class="text-[9px] text-gray-500 font-normal">Perjalanan</span>
                  </td>
                  <td class="p-3 text-right font-black text-green-800 text-sm">
                    ${formatRp(summary.total_pendapatan || 0)}
                  </td>
                  <td class="p-3 text-right font-black text-red-700 text-sm">
                    ${formatRp(summary.total_biaya || 0)}
                    <br><span class="text-[9px] text-gray-500 font-normal">BBM: ${formatRp(summary.total_bbm || 0)} | Servis: ${formatRp(summary.total_servis || 0)}</span>
                  </td>
                  <td class="p-3 text-right font-black text-custom-green text-sm bg-green-50/70 border-x border-green-200">
                    ${formatRp(summary.total_porsi_pengelola || 0)}
                    <br><span class="text-[9px] text-custom-green font-normal">Kas Porsi Pengelola (30%)</span>
                  </td>
                  <td class="p-3 text-right font-black text-purple-900 text-sm bg-purple-50/70">
                    ${formatRp(summary.total_porsi_investor || 0)}
                    <br><span class="text-[9px] text-purple-700 font-normal">Hak Semua Investor</span>
                  </td>
                </tr>
              `;
            } else {
              tfoot.innerHTML = `
                <tr class="bg-gray-100/95 text-gray-900 border-t-2 border-gray-400 text-xs">
                  <td class="p-3 font-black text-gray-900">
                    JUMLAH TOTAL
                    <br><span class="text-[10px] text-gray-500 font-bold">${list.length} Unit Armada Aktif</span>
                  </td>
                  <td class="p-3 text-center text-gray-400 font-normal">—</td>
                  <td class="p-3 text-center font-black text-gray-800 text-sm">
                    ${summary.total_transaksi || 0}x
                    <br><span class="text-[9px] text-gray-500 font-normal">Perjalanan</span>
                  </td>
                  <td class="p-3 text-right font-black text-green-800 text-sm">
                    ${formatRp(summary.total_pendapatan || 0)}
                  </td>
                  <td class="p-3 text-right font-black text-red-700 text-sm">
                    ${formatRp(summary.total_biaya || 0)}
                    <br><span class="text-[9px] text-gray-500 font-normal">BBM: ${formatRp(summary.total_bbm || 0)} | Servis: ${formatRp(summary.total_servis || 0)}</span>
                  </td>
                  <td class="p-3 text-right font-black text-indigo-800 text-sm">
                    ${formatRp(summary.total_laba_bersih || 0)}
                  </td>
                  <td class="p-3 text-right font-black text-custom-green text-sm bg-green-50/70 border-x border-green-200">
                    ${formatRp(summary.total_porsi_pengelola || 0)}
                    <br><span class="text-[9px] text-custom-green font-normal">Kas Bersih JRC Trans</span>
                  </td>
                  <td class="p-3 text-right font-black text-purple-900 text-sm bg-purple-50/70">
                    ${formatRp(summary.total_porsi_investor || 0)}
                    <br><span class="text-[9px] text-purple-700 font-normal">Hak Semua Investor</span>
                  </td>
                </tr>
              `;
            }
          }
        }

        // MASTER-DETAIL: RINCIAN TRANSAKSI HARIAN & FREKUENSI PER UNIT MOBIL
        const detailContainer = document.getElementById('allreport-detail-content');
        if (detailContainer) {
          if (list.length === 0) {
            detailContainer.innerHTML = `
              <div class="p-8 text-center text-gray-400 font-medium bg-gray-50 rounded-xl border border-dashed border-gray-300">
                <i class="fa-solid fa-inbox text-3xl mb-2 text-gray-300 block"></i>
                Tidak ada rincian transaksi armada pada periode ${labelPeriod}.
              </div>
            `;
          } else {
            let detailHtml = '';
            list.forEach((d, unitIdx) => {
              const totPend = Number(d.total_pendapatan) || 0;
              const bbm = Number(d.biaya_bbm) || 0;
              const servis = Number(d.biaya_servis) || 0;
              const lainnya = Number(d.biaya_lainnya) || 0;
              const totBiaya = Number(d.total_biaya) || (bbm + servis + lainnya);
              const porsiPengelola = Number(d.porsi_pengelola) || 0;
              const porsiInvestor = Number(d.porsi_investor) || 0;
              const txList = d.riwayat_transaksi || [];
              const isInv = d.is_investor;

              detailHtml += `
                <div class="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white">
                  <!-- Header Unit Mobil & Frekuensi Transaksi -->
                  <div class="bg-gray-100/90 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-3">
                      <span class="w-7 h-7 rounded-lg ${isInv ? 'bg-purple-700' : 'bg-custom-green'} text-white flex items-center justify-center font-black text-xs">
                        ${unitIdx + 1}
                      </span>
                      <div>
                        <h3 class="font-black text-gray-800 text-sm md:text-base flex items-center gap-2">
                          ${d.nama_mobil}
                          <span class="text-xs font-mono font-bold bg-white text-gray-700 px-2 py-0.5 rounded border border-gray-300">${d.plat_nomor}</span>
                        </h3>
                        <p class="text-[10px] text-gray-500 font-medium">
                          Tahun: ${d.tahun || '-'} | Kepemilikan: 
                          <span class="font-bold ${isInv ? 'text-purple-700' : 'text-custom-green'}">
                            ${isInv ? 'Mitra Investor (Bagi Hasil 70:30)' : 'Milik JRC Trans (100% Hak Kas)'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="${isInv ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-green-100 text-green-800 border-green-200'} text-xs font-bold px-3 py-1.5 rounded-full border shadow-2xs">
                        <i class="fa-solid fa-car-side mr-1.5"></i> ${txList.length}x Transaksi Rental (${labelPeriod})
                      </span>
                    </div>
                  </div>

                  <!-- Tabel Transaksi Harian / Tanggal per Tanggal -->
                  <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr class="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                          <th class="p-2.5 text-center w-10">No</th>
                          <th class="p-2.5 w-24">Tanggal</th>
                          <th class="p-2.5 w-32">Penyewa</th>
                          <th class="p-2.5 text-right w-28 text-emerald-800">Tarif Sewa</th>
                          <th class="p-2.5 text-right w-20 text-red-600">BBM</th>
                          <th class="p-2.5 text-right w-24 text-orange-600">Servis/Oli</th>
                          <th class="p-2.5 text-right w-20 text-gray-600">Lainnya</th>
                          <th class="p-2.5 text-right w-24 text-red-700">Total Biaya</th>
                          <th class="p-2.5 text-right w-28 ${isInv ? 'text-blue-700' : 'text-custom-green'} font-bold">
                            ${isInv ? 'Porsi JRC (30%)' : 'Kas JRC (100%)'}
                          </th>
                          ${isInv ? '<th class="p-2.5 text-right w-28 text-purple-700 font-bold">Hak Investor</th>' : ''}
                          <th class="p-2.5">Keterangan Operasional</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100">
              `;

              if (txList.length === 0) {
                const colSpan = isInv ? 11 : 10;
                detailHtml += `<tr><td colspan="${colSpan}" class="p-4 text-center text-gray-400 font-medium">Belum ada catatan transaksi sewa untuk unit ini pada periode ${labelPeriod}.</td></tr>`;
              } else {
                txList.forEach((tx, txIdx) => {
                  const txTarif = Number(tx.tarif_sewa !== undefined ? tx.tarif_sewa : tx.tarif) || 0;
                  const txBbm = Number(tx.biaya_bbm) || 0;
                  const txServis = Number(tx.biaya_servis) || 0;
                  const txLain = Number(tx.biaya_lainnya) || 0;
                  const txBiaya = txBbm + txServis + txLain;
                  const txLaba = txTarif - txBiaya;
                  const txPeng = isInv ? Math.round(txTarif * 0.30) : txLaba;
                  const txInv = isInv ? (Math.round(txTarif * 0.70) - txBiaya) : 0;

                  detailHtml += `
                    <tr class="hover:bg-gray-50 transition">
                      <td class="p-2.5 text-center font-bold text-gray-400">${txIdx + 1}</td>
                      <td class="p-2.5 font-bold text-gray-700 whitespace-nowrap"><i class="fa-regular fa-calendar text-gray-400 mr-1"></i>${tx.tanggal || '-'}</td>
                      <td class="p-2.5 font-bold text-gray-800">${tx.penyewa || '-'}</td>
                      <td class="p-2.5 text-right font-bold text-emerald-700">${formatRp(txTarif)}</td>
                      <td class="p-2.5 text-right font-semibold ${txBbm > 0 ? 'text-red-600' : 'text-gray-400'}">${formatRp(txBbm)}</td>
                      <td class="p-2.5 text-right font-semibold ${txServis > 0 ? 'text-orange-600 font-bold' : 'text-gray-400'}">${formatRp(txServis)}</td>
                      <td class="p-2.5 text-right font-semibold ${txLain > 0 ? 'text-gray-700' : 'text-gray-400'}">${formatRp(txLain)}</td>
                      <td class="p-2.5 text-right font-bold text-red-700">${formatRp(txBiaya)}</td>
                      <td class="p-2.5 text-right font-bold ${isInv ? 'text-blue-700' : 'text-custom-green'}">${formatRp(txPeng)}</td>
                      ${isInv ? `<td class="p-2.5 text-right font-bold text-purple-700">${formatRp(txInv)}</td>` : ''}
                      <td class="p-2.5 text-gray-600 italic text-[11px]">${tx.keterangan || '-'}</td>
                    </tr>
                  `;
                });
              }

              detailHtml += `
                      </tbody>
                    </table>
                  </div>

                  <!-- Subtotal Finansial Unit -->
                  <div class="bg-gray-50/90 p-4 border-t border-gray-200">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                        <span class="text-gray-500 font-semibold block text-[10px] uppercase">Total Omset Sewa Unit</span>
                        <span class="text-sm font-black text-emerald-700">${formatRp(totPend)}</span>
                        <span class="text-[10px] text-gray-400 block">${txList.length}x Perjalanan Rental</span>
                      </div>

                      <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                        <span class="text-gray-500 font-semibold block text-[10px] uppercase">Total Biaya Operasional</span>
                        <span class="text-sm font-black text-rose-700">${formatRp(totBiaya)}</span>
                        <span class="text-[9px] text-gray-500 block">BBM: ${formatRp(bbm)} | Servis: ${formatRp(servis)}</span>
                      </div>

                      <div class="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                        <span class="text-gray-500 font-semibold block text-[10px] uppercase">
                          ${isInv ? 'Kas JRC Trans (30% Gross)' : 'Kas Bersih JRC Trans (100%)'}
                        </span>
                        <span class="text-sm font-black ${isInv ? 'text-blue-700' : 'text-custom-green'}">${formatRp(porsiPengelola)}</span>
                        <span class="text-[10px] text-gray-400 block">${isInv ? 'Komisi Pengelolaan Armada' : 'Laba Bersih Perusahaan'}</span>
                      </div>

                      <div class="${isInv ? 'bg-purple-50/80 border-purple-200' : 'bg-gray-50 border-gray-200'} p-2.5 rounded-lg border shadow-2xs">
                        <span class="text-gray-500 font-semibold block text-[10px] uppercase">
                          ${isInv ? 'Hak Bersih Investor' : 'Hak Investor'}
                        </span>
                        <span class="text-sm md:text-base font-black ${isInv ? 'text-purple-900' : 'text-gray-400'}">
                          ${isInv ? formatRp(porsiInvestor) : 'Rp 0 (Unit Sendiri)'}
                        </span>
                        <span class="text-[9px] ${isInv ? 'text-purple-700' : 'text-gray-400'} block">
                          ${isInv ? '70% Gross - Biaya Operasional' : '100% Hak Kas Milik JRC Trans'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            });
            detailContainer.innerHTML = detailHtml;
          }
        }
      } catch (e) {
        console.error('Error load all report:', e);
      }
    }

    function downloadPDFAllReport() {
      if (typeof html2pdf === 'undefined') {
        alert('Library html2pdf belum dimuat dari CDN. Pastikan koneksi internet aktif.');
        return;
      }
      const element = document.getElementById('allreport-pdf-container');
      if (!element) {
        alert('Konten laporan tidak ditemukan!');
        return;
      }
      const categoryNames = {
        all: 'Laporan_Keseluruhan_JRCTrans',
        investor: 'Laporan_Unit_Investor_JRCTrans',
        sendiri: 'Laporan_Unit_Milik_Sendiri_JRCTrans'
      };
      let prefix = categoryNames[currentAllReportCategory] || 'Laporan_JRCTrans';
      const mobilSelect = document.getElementById('allreport-filter-mobil');
      const mobilId = mobilSelect ? (mobilSelect.value || 'all') : 'all';
      if (mobilId !== 'all' && mobilSelect) {
        const carName = mobilSelect.options[mobilSelect.selectedIndex]?.text?.replace(/[^a-zA-Z0-9]/g, '_') || '';
        prefix += `_${carName}`;
      }

      const opt = {
        margin:       0.4,
        filename:     `${prefix}_${new Date().toISOString().split('T')[0]}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
      };
      html2pdf().from(element).set(opt).save();
    }

    // =========================================================================
    // PWA & SERVICE WORKER
    // =========================================================================
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => console.log('PWA ServiceWorker ready:', reg.scope))
          .catch(err => console.error('PWA ServiceWorker registration failed:', err));
      });
    }

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const btnInstall = document.getElementById('btn-install-pwa');
      if (btnInstall) {
        btnInstall.classList.remove('hidden');
        btnInstall.classList.add('flex');
      }
    });

    async function installPWA() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('Install prompt result:', outcome);
      deferredPrompt = null;
      const btnInstall = document.getElementById('btn-install-pwa');
      if (btnInstall) {
        btnInstall.classList.add('hidden');
        btnInstall.classList.remove('flex');
      }
    }

    // Auto Init on Startup
    window.onload = function() {
      const token = localStorage.getItem('JRC_token');
      if (token) {
        initApp();
      } else {
        showLoginScreen();
      }
    };
