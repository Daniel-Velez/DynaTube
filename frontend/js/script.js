// ==========================================
// DYNATUBE PRO — MAIN APP v3.0
// ==========================================

class DynatubeApp {
  constructor() {
    this.currentPage     = 'search';
    this.downloadQueue   = new Map();   // taskId → { id, titulo, tipo, status, progress, paused }
    this.pollingIntervals = new Map();  // taskId → intervalId
    this.isSearching     = false;
    this.currentSearchQuery = '';
    this.currentSearchIndex = 0;
    this.allResultsLoaded = false;      // para scroll infinito

    this.init();
    this.updateUserProfile();
    this.setupAuthEventListeners();
  }

  // ==========================================
  // INIT
  // ==========================================
  init() {
    this.setupEventListeners();
    this.loadTheme();
    this.setupInfiniteScroll();
    this.setupDropZone();
    this.registerServiceWorker();
  }

  setupEventListeners() {
    // Auth
    document.getElementById('btnShowAuth')?.addEventListener('click', () => {
      document.getElementById('authScreen').style.display = 'flex';
    });
    document.getElementById('closeAuth')?.addEventListener('click', () => {
      document.getElementById('authScreen').style.display = 'none';
    });
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión?')) return;
      await authManager.logout();
      window.location.reload();
    });

    // Navigation
    document.querySelectorAll('.menu-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchPage(btn.dataset.page));
    });

    // Theme
    document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());

    // Search
    document.getElementById('btnSearch')?.addEventListener('click', () => this.startSearch());
    document.getElementById('searchInput')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.startSearch();
    });

    // Converter
    document.getElementById('btnSelectFiles')?.addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput')?.addEventListener('change', e => {
      if (e.target.files.length > 0) this.convertFile(e.target.files[0]);
    });

    // History
    document.getElementById('btnRefreshHistory')?.addEventListener('click', () => this.loadHistory());

    // Queue
    document.getElementById('btnClearQueue')?.addEventListener('click', () => this.clearQueue());

    // Modal
    document.getElementById('closeModal')?.addEventListener('click', () => this.closePreviewModal());
    document.getElementById('previewModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('previewModal')) this.closePreviewModal();
    });

    // Admin
    document.getElementById('btnAdminCleanup')?.addEventListener('click', () => this.adminForceCleanup());
    document.getElementById('btnRefreshAdminStats')?.addEventListener('click', () => this.loadAdminStats());
  }

  setupAuthEventListeners() {
    document.getElementById('showRegister')?.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('loginForm').classList.remove('active');
      document.getElementById('registerForm').classList.add('active');
    });
    document.getElementById('showLogin')?.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('registerForm').classList.remove('active');
      document.getElementById('loginForm').classList.add('active');
    });
    document.getElementById('btnLogin')?.addEventListener('click', () => this.handleLogin());
    document.getElementById('loginPassword')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.handleLogin();
    });
    document.getElementById('btnRegister')?.addEventListener('click', () => this.handleRegister());
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // ==========================================
  // AUTH
  // ==========================================
  async handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('btnLogin');
    if (!username || !password) return this.showAuthError('Completa todos los campos');

    btn.classList.add('loading'); btn.disabled = true;
    try {
      await authManager.login(username, password);
      document.getElementById('authScreen').style.display = 'none';
      this.updateUserProfile();
      if (this.currentPage === 'history') this.loadHistory();
      this.showToast('¡Bienvenido de vuelta!', 'success');
    } catch (err) {
      this.showAuthError(err.message);
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  }

  async handleRegister() {
    const username  = document.getElementById('registerUsername').value.trim();
    const email     = document.getElementById('registerEmail').value.trim();
    const fullName  = document.getElementById('registerFullName').value.trim();
    const password  = document.getElementById('registerPassword').value;
    const confirm   = document.getElementById('registerPasswordConfirm').value;
    const btn       = document.getElementById('btnRegister');

    if (!username || !email || !password || !fullName) return this.showAuthError('Completa todos los campos', 'register');
    if (password !== confirm) return this.showAuthError('Las contraseñas no coinciden', 'register');
    if (password.length < 6)  return this.showAuthError('Mínimo 6 caracteres', 'register');

    btn.classList.add('loading'); btn.disabled = true;
    try {
      await authManager.register(username, email, password, fullName);
      this.showAuthSuccess('¡Cuenta creada! Inicia sesión', 'register');
      setTimeout(() => {
        document.getElementById('registerForm').classList.remove('active');
        document.getElementById('loginForm').classList.add('active');
        document.getElementById('loginUsername').value = username;
      }, 2000);
    } catch (err) {
      this.showAuthError(err.message, 'register');
    } finally {
      btn.classList.remove('loading'); btn.disabled = false;
    }
  }

  showAuthError(msg, form = 'login') {
    const el = document.getElementById(form === 'login' ? 'loginForm' : 'registerForm');
    el.querySelector('.form-error')?.remove();
    const d = document.createElement('div');
    d.className = 'form-error';
    d.textContent = msg;
    el.insertBefore(d, el.querySelector('.btn-auth-submit'));
    setTimeout(() => d.remove(), 5000);
  }

  showAuthSuccess(msg, form = 'login') {
    const el = document.getElementById(form === 'login' ? 'loginForm' : 'registerForm');
    el.querySelector('.form-success')?.remove();
    const d = document.createElement('div');
    d.className = 'form-success';
    d.textContent = msg;
    el.insertBefore(d, el.querySelector('.btn-auth-submit'));
    setTimeout(() => d.remove(), 4000);
  }

  updateUserProfile() {
    const user   = authManager.getCurrentUser();
    const isAuth = authManager.isAuthenticated();

    document.getElementById('btnAdminPanel')?.remove();

    const avatarEl   = document.getElementById('userAvatar');
    const nameEl     = document.getElementById('userName');
    const logoutBtn  = document.getElementById('btnLogout');
    const loginBtn   = document.getElementById('btnShowAuth');
    const anonWarn   = document.getElementById('anonymousWarning');
    const nav        = document.querySelector('.nav-menu');

    if (isAuth && user) {
      if (avatarEl)  avatarEl.textContent  = user.username.charAt(0).toUpperCase();
      if (nameEl)    nameEl.textContent    = user.full_name || user.username;
      if (logoutBtn) logoutBtn.style.display = 'block';
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (anonWarn)  anonWarn.style.display  = 'none';

      if (user.is_admin && nav) {
        const btn = document.createElement('button');
        btn.id = 'btnAdminPanel';
        btn.className = 'menu-btn admin-special';
        btn.dataset.page = 'admin';
        btn.textContent = '⚙️ Admin';
        btn.addEventListener('click', () => this.switchPage('admin'));
        nav.appendChild(btn);
      }
    } else {
      if (avatarEl)  avatarEl.textContent  = '?';
      if (nameEl)    nameEl.textContent    = 'Invitado';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (loginBtn)  loginBtn.style.display  = 'block';
      if (anonWarn)  anonWarn.style.display  = 'flex';
    }
  }

  // ==========================================
  // NAVIGATION & THEME
  // ==========================================
  switchPage(page) {
    document.querySelectorAll('.menu-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`${page}-page`);
    if (target) target.classList.add('active');
    this.currentPage = page;
    if (page === 'history') this.loadHistory();
    if (page === 'admin')   this.loadAdminStats();
  }

  toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('themeToggle').textContent = next === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro';
    localStorage.setItem('theme', next);
  }

  loadTheme() {
    const t = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('themeToggle').textContent = t === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro';
  }

  // ==========================================
  // SEARCH (con paginación y scroll infinito)
  // ==========================================
  async startSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query || this.isSearching) return;
    this.currentSearchQuery = query;
    this.currentSearchIndex = 0;
    this.allResultsLoaded = false;
    document.getElementById('videoGrid').innerHTML = '';
    await this.executeSearch();
  }

  async executeSearch() {
    if (this.isSearching || this.allResultsLoaded) return;

    this.isSearching = true;
    this.showLoading(true);
    this.setStatus('Buscando...', '#ffaa44');

    try {
      // Llamada al API sin parámetro 'limit' (el backend usa 15 por defecto)
      const result = await api.searchVideos(this.currentSearchQuery, this.currentSearchIndex);

      if (!result.videos || result.videos.length === 0) {
        this.allResultsLoaded = true;
        if (this.currentSearchIndex === 0) {
          this.setStatus('Sin resultados', '#ff3b55');
        } else {
          this.setStatus('Fin de los resultados', '#ffaa44');
        }
        return;
      }

      // Agregar los videos al grid
      result.videos.forEach(v => this.addVideoCard(v));
      this.setStatus('Listo', '#00e5ff');

      // Actualizar el índice correctamente (el backend devuelve la cantidad exacta en esta página)
      this.currentSearchIndex += result.videos.length;

      if (!result.has_more) {
        this.allResultsLoaded = true;
        this.setStatus('Fin de los resultados', '#00e5ff');
      }
    } catch (err) {
      this.setStatus(`Error: ${err.message}`, '#ff3b55');
      this.showToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      this.isSearching = false;
      this.showLoading(false);
    }
  }

  addVideoCard(video) {
    const grid = document.getElementById('videoGrid');
    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="video-thumb-container">
        <img src="${video.thumb}" alt="${this.escapeHtml(video.titulo)}" class="video-thumb" loading="lazy">
        <div class="video-thumb-overlay">
          <button class="btn-play-overlay" aria-label="Previsualizar">▶</button>
        </div>
        <div class="video-duration">${video.duracion}</div>
      </div>
      <div class="video-info">
        <div class="video-avatar">${video.uploader.charAt(0).toUpperCase()}</div>
        <div class="video-text">
          <div class="video-title">${this.escapeHtml(video.titulo)}</div>
          <div class="video-channel">${this.escapeHtml(video.uploader)}</div>
        </div>
      </div>
      <div class="video-actions">
        <select class="quality-select" title="Seleccionar calidad">
          <option value="">Calidad...</option>
        </select>
        <button class="btn-action btn-action-preview" title="Previsualizar en YouTube">👁</button>
        <button class="btn-action btn-action-mp4" data-type="video">▼ MP4</button>
        <button class="btn-action btn-action-mp3" data-type="audio">♫ MP3</button>
      </div>
    `;

    const qs      = card.querySelector('.quality-select');
    const mp4Btn  = card.querySelector('[data-type="video"]');
    const mp3Btn  = card.querySelector('[data-type="audio"]');
    const prevBtn = card.querySelector('.btn-action-preview');
    const overlayBtn = card.querySelector('.btn-play-overlay');

    qs.addEventListener('focus', async () => {
      if (qs.children.length === 1) await this.loadQualities(video.url, qs);
    });

    prevBtn.addEventListener('click', () => this.openPreview(video.url));
    overlayBtn.addEventListener('click', () => this.openPreview(video.url));

    mp4Btn.addEventListener('click', () => {
      const fmtId = qs.value;
      if (!fmtId) { this.showToast('Selecciona una calidad primero', 'error'); return; }
      this.startDownload(video.url, 'video', fmtId, video.titulo);
    });

    mp3Btn.addEventListener('click', () => {
      this.startDownload(video.url, 'audio', null, video.titulo);
    });

    grid.appendChild(card);
  }

  async loadQualities(url, selectEl) {
    selectEl.innerHTML = '<option>Cargando...</option>';
    try {
      const result = await api.getQualities(url);
      selectEl.innerHTML = '';
      result.qualities.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.format_id;
        const size = q.filesize ? ` · ${(q.filesize / 1048576).toFixed(1)} MB` : '';
        opt.textContent = `${q.resolution}${size}`;
        selectEl.appendChild(opt);
      });
    } catch {
      selectEl.innerHTML = '<option value="">Error al cargar</option>';
    }
  }

  openPreview(url) {
    const vid = this.extractVideoId(url);
    if (!vid) { this.showToast('No se puede previsualizar este enlace', 'error'); return; }
    window.open(`https://www.youtube.com/watch?v=${vid}`, '_blank', 'noopener');
  }

  closePreviewModal() {
    const modal = document.getElementById('previewModal');
    modal?.classList.remove('active');
    setTimeout(() => {
      const container = document.getElementById('modalVideoContainer');
      if (container) container.innerHTML = '';
    }, 300);
  }

  extractVideoId(url) {
    const m = url.match(/(?:youtu\.be\/|v\/|watch\?v=|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // ==========================================
  // DOWNLOAD QUEUE
  // ==========================================
  async startDownload(url, tipo, formatId, titulo) {
    try {
      const result = await api.startDownload(url, tipo, formatId, titulo);
      const taskId = result.task_id;
      this.downloadQueue.set(taskId, { id: taskId, titulo, tipo, status: 'pending', progress: 0, paused: false });
      this.addQueueItem(taskId, titulo, tipo);
      this.updateQueueCount();
      this.startPolling(taskId);
      this.showToast(`Descarga iniciada`, 'success');
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  addQueueItem(taskId, titulo, tipo) {
    const list = document.getElementById('queueList');
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.taskId = taskId;

    const typeEmoji = tipo === 'audio' ? '🎵' : '🎬';
    const typeCls   = tipo === 'audio' ? 'audio' : 'video';

    item.innerHTML = `
      <div class="queue-item-header">
        <div class="queue-type-badge ${typeCls}">${typeEmoji}</div>
        <div class="queue-item-title">${this.escapeHtml(titulo)}</div>
        <div class="queue-controls">
          <button class="btn-ctrl btn-ctrl-pause" data-task="${taskId}" aria-label="Pausar">
            <div class="icon-pause"><span></span><span></span></div>
          </button>
          <button class="btn-ctrl btn-ctrl-cancel" data-task="${taskId}" aria-label="Cancelar">✕</button>
        </div>
      </div>
      <div class="queue-item-footer">
        <div class="queue-item-status">En espera...</div>
        <div class="queue-item-pct">0%</div>
      </div>
      <div class="queue-progress">
        <div class="queue-progress-fill" style="width:0%"></div>
      </div>
    `;

    item.querySelector('.btn-ctrl-pause').addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePause(taskId);
    });
    item.querySelector('.btn-ctrl-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      this.cancelTask(taskId);
    });

    list.appendChild(item);
  }

  togglePause(taskId) {
    const task = this.downloadQueue.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'error') return;

    task.paused = !task.paused;
    const item = document.querySelector(`[data-task-id="${taskId}"]`);
    const btn  = document.querySelector(`.btn-ctrl-pause[data-task="${taskId}"]`);
    if (!btn) return;

    if (task.paused) {
      const interval = this.pollingIntervals.get(taskId);
      if (interval) { clearInterval(interval); this.pollingIntervals.delete(taskId); }
      btn.classList.add('paused');
      btn.setAttribute('aria-label', 'Reanudar');
      btn.innerHTML = '<div class="icon-play"></div>';
      this.updateQueueItemStatus(taskId, 'Pausado', task.progress);
      this.showToast('Descarga pausada', 'info');
    } else {
      btn.classList.remove('paused');
      btn.setAttribute('aria-label', 'Pausar');
      btn.innerHTML = '<div class="icon-pause"><span></span><span></span></div>';
      this.startPolling(taskId);
      this.showToast('Descarga reanudada', 'success');
    }
  }

  async cancelTask(taskId) {
    const task = this.downloadQueue.get(taskId);
    if (!task) return;

    const interval = this.pollingIntervals.get(taskId);
    if (interval) { clearInterval(interval); this.pollingIntervals.delete(taskId); }

    try { await api.cancelTask(taskId); } catch {}

    this.downloadQueue.delete(taskId);
    document.querySelector(`[data-task-id="${taskId}"]`)?.remove();
    this.updateQueueCount();
    this.showToast('Descarga cancelada', 'info');
  }

  startPolling(taskId) {
    if (this.pollingIntervals.has(taskId)) return;

    const interval = setInterval(async () => {
      const task = this.downloadQueue.get(taskId);
      if (!task || task.paused) return;

      try {
        const data = await api.getTaskStatus(taskId);
        this.updateQueueItemStatus(taskId, data.status, data.progress, data.downloaded, data.total);
        task.status   = data.status;
        task.progress = data.progress || 0;

        if (data.status === 'completed') {
          clearInterval(interval);
          this.pollingIntervals.delete(taskId);
          api.downloadFile(taskId, `${data.titulo}.${task.tipo === 'audio' ? 'mp3' : 'mp4'}`);
          this.showToast(`✅ Descarga completada`, 'success');
          setTimeout(() => {
            document.querySelector(`[data-task-id="${taskId}"]`)?.remove();
            this.downloadQueue.delete(taskId);
            this.updateQueueCount();
          }, 4000);
        } else if (data.status === 'error') {
          clearInterval(interval);
          this.pollingIntervals.delete(taskId);
          this.showToast(`❌ Error en descarga`, 'error');
        }
      } catch (err) {
        clearInterval(interval);
        this.pollingIntervals.delete(taskId);
      }
    }, 1000);

    this.pollingIntervals.set(taskId, interval);
  }

  updateQueueItemStatus(taskId, status, progress = 0, downloaded, total) {
    const item = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!item) return;

    const statusEl   = item.querySelector('.queue-item-status');
    const pctEl      = item.querySelector('.queue-item-pct');
    const progressEl = item.querySelector('.queue-progress-fill');

    let statusText = 'En espera...';
    let fillClass  = '';

    switch (status) {
      case 'downloading':
        statusText = downloaded != null
          ? `Descargando · ${downloaded.toFixed(1)} / ${(total || 0).toFixed(1)} MB`
          : 'Descargando...';
        break;
      case 'processing':
        statusText = 'Procesando...';
        progress   = 99;
        break;
      case 'completed':
        statusText = 'Completado';
        progress   = 100;
        fillClass  = 'done';
        item.classList.add('is-completed');
        item.querySelectorAll('.btn-ctrl').forEach(b => b.style.display = 'none');
        break;
      case 'error':
        statusText = 'Error en la descarga';
        progress   = 0;
        fillClass  = 'error';
        item.classList.add('is-error');
        item.querySelectorAll('.btn-ctrl').forEach(b => b.style.display = 'none');
        break;
      case 'Pausado':
        statusText = 'Pausado';
        break;
    }

    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.className   = `queue-item-status${status === 'completed' ? ' done' : status === 'error' ? ' error' : ''}`;
    }
    if (pctEl)      pctEl.textContent = `${Math.min(progress, 100)}%`;
    if (progressEl) {
      progressEl.style.width = `${Math.min(progress, 100)}%`;
      progressEl.className   = `queue-progress-fill${fillClass ? ' ' + fillClass : ''}`;
    }
  }

  async clearQueue() {
    for (const [taskId, interval] of this.pollingIntervals) {
      clearInterval(interval);
      try { await api.cancelTask(taskId); } catch {}
    }
    this.pollingIntervals.clear();
    this.downloadQueue.clear();
    document.getElementById('queueList').innerHTML = '';
    this.updateQueueCount();
    this.showToast('Cola vaciada', 'info');
  }

  updateQueueCount() {
    const el = document.getElementById('queueCount');
    if (el) el.textContent = this.downloadQueue.size;
  }

  // ==========================================
  // CONVERTER
  // ==========================================
  setupDropZone() {
    const zone = document.getElementById('converterDropZone');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) this.convertFile(file);
      else this.showToast('Solo archivos de video', 'error');
    });
  }

  async convertFile(file) {
    const statusEl   = document.getElementById('converterStatus');
    const progressEl = document.getElementById('converterProgress');
    statusEl.textContent = `Procesando: ${file.name}`;
    progressEl.style.width = '0%';
    try {
      await api.convertToMP3(file, pct => { progressEl.style.width = `${pct}%`; });
      statusEl.textContent = '✅ Conversión completada';
      progressEl.style.width = '100%';
      this.showToast('Archivo convertido con éxito', 'success');
      setTimeout(() => { statusEl.textContent = 'Listo.'; progressEl.style.width = '0%'; }, 4000);
    } catch (err) {
      statusEl.textContent = '❌ Error en conversión';
      progressEl.style.width = '0%';
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // HISTORY
  // ==========================================
  async loadHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">⏳</div>Cargando...</div>';

    try {
      const history = await api.getHistory();
      list.innerHTML = '';

      if (!history || history.length === 0) {
        list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">📭</div>No hay descargas en el historial</div>';
        return;
      }

      history.forEach(item => {
        const isAudio = item.type === 'audio' || item.format === 'mp3';
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
          <div class="history-type-icon ${isAudio ? 'audio' : 'video'}">${isAudio ? '🎵' : '🎬'}</div>
          <div class="history-text">
            <div class="history-title-text">${this.escapeHtml(item.title)}</div>
            <div class="history-date">${new Date(item.date).toLocaleString()}</div>
          </div>
          ${item.url ? `<button class="btn-history-link" onclick="window.open('${this.escapeHtml(item.url)}','_blank','noopener')">🌐 Abrir</button>` : ''}
        `;
        list.appendChild(card);
      });
    } catch (err) {
      list.innerHTML = `<div class="history-empty"><div class="history-empty-icon">❌</div>Error cargando historial. ¿Iniciaste sesión?</div>`;
    }
  }

  // ==========================================
  // ADMIN (simplificado, igual que antes)
  // ==========================================
  async loadAdminStats() {
    const user = authManager.getCurrentUser();
    if (!user?.is_admin) { this.showToast('Acceso denegado', 'error'); this.switchPage('search'); return; }

    try {
      const res  = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/stats`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.renderAdminStats(data);
      await Promise.all([this.loadAdminUsers(), this.loadAdminDownloads(), this.loadAdminSessions()]);
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error');
    }
  }

  renderAdminStats(data) {
    const el = document.getElementById('adminStatsContent');
    if (!el) return;
    el.innerHTML = `
      <div class="admin-stat-card">
        <div class="stat-value">${data.users.total}</div>
        <div class="stat-label">Usuarios</div>
        <div class="stat-sublabel">${data.users.active} activos</div>
      </div>
      <div class="admin-stat-card">
        <div class="stat-value">${data.downloads.total}</div>
        <div class="stat-label">Descargas</div>
        <div class="stat-sublabel">${data.downloads.today} hoy</div>
      </div>
      <div class="admin-stat-card">
        <div class="stat-value">${data.system.disk_usage_mb.toFixed(1)} MB</div>
        <div class="stat-label">Disco Usado</div>
      </div>
      <div class="admin-stat-card">
        <div class="stat-value">${data.system.active_tasks}</div>
        <div class="stat-label">Tareas Activas</div>
      </div>
    `;
  }

  async loadAdminUsers() {
    const el = document.getElementById('adminUsersTable');
    if (!el) return;
    try {
      const res   = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/users`);
      const users = await res.json();
      el.innerHTML = `
        <div class="admin-section-title">👥 Usuarios del Sistema</div>
        <div class="admin-table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Usuario</th><th>Email</th><th>Descargas</th><th>Estado</th><th>Rol</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">#${u.id}</code></td>
                  <td><strong>${this.escapeHtml(u.username)}</strong></td>
                  <td style="color:var(--text-secondary)">${this.escapeHtml(u.email)}</td>
                  <td style="text-align:center">${u.download_count}</td>
                  <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                  <td>${u.is_admin ? '<span class="badge badge-admin">Admin</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
                  <td>
                    <button class="btn-table ${u.is_active ? 'btn-table-deactivate' : 'btn-table-activate'}" onclick="app.toggleUserActive(${u.id},${!u.is_active})">${u.is_active ? 'Desactivar' : 'Activar'}</button>
                    <button class="btn-table btn-table-admin" onclick="app.toggleUserAdmin(${u.id},${!u.is_admin})">${u.is_admin ? 'Quitar Admin' : 'Hacer Admin'}</button>
                    ${u.id !== authManager.getCurrentUser()?.id ? `<button class="btn-table btn-table-delete" onclick="app.deleteUser(${u.id})">🗑</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {}
  }

  async loadAdminDownloads() {
    const el = document.getElementById('adminDownloadsTable');
    if (!el) return;
    try {
      const res  = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/downloads?limit=50`);
      const dls  = await res.json();
      el.innerHTML = `
        <div class="admin-section-title">⬇️ Últimas Descargas</div>
        <div class="admin-table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Usuario</th><th>Título</th><th>Tipo</th><th>Fecha</th></tr></thead>
            <tbody>
              ${dls.slice(0,25).map(d => `
                <tr>
                  <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">#${d.id}</code></td>
                  <td><strong>${this.escapeHtml(d.username || 'Anónimo')}</strong></td>
                  <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(d.title)}</td>
                  <td>${d.type === 'audio' ? '🎵 MP3' : '🎬 MP4'}</td>
                  <td style="color:var(--text-secondary);font-family:var(--font-mono);font-size:11px">${new Date(d.date).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {}
  }

  async loadAdminSessions() {
    const el = document.getElementById('adminSessionsTable');
    if (!el) return;
    try {
      const res      = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/sessions`);
      const sessions = await res.json();
      el.innerHTML = `
        <div class="admin-section-title">🔐 Sesiones Activas</div>
        <div class="admin-table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Usuario</th><th>IP</th><th>Creada</th><th>Acción</th></tr></thead>
            <tbody>
              ${sessions.map(s => `
                <tr>
                  <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">#${s.id}</code></td>
                  <td><strong>${this.escapeHtml(s.username)}</strong></td>
                  <td style="font-family:var(--font-mono);font-size:11px">${s.ip_address}</td>
                  <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${new Date(s.created_at).toLocaleString()}</td>
                  <td><button class="btn-table btn-table-revoke" onclick="app.revokeSession(${s.id})">Revocar</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch {}
  }

  async toggleUserActive(userId, isActive) {
    if (!confirm(`¿${isActive ? 'Activar' : 'Desactivar'} este usuario?`)) return;
    try {
      const res = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/users/${userId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({is_active: isActive})
      });
      if (!res.ok) throw new Error();
      this.showToast('Usuario actualizado', 'success');
      this.loadAdminUsers();
    } catch { this.showToast('Error actualizando usuario', 'error'); }
  }

  async toggleUserAdmin(userId, isAdmin) {
    if (!confirm(`¿${isAdmin ? 'Otorgar' : 'Quitar'} permisos de admin?`)) return;
    try {
      const res = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/users/${userId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({is_admin: isAdmin})
      });
      if (!res.ok) throw new Error();
      this.showToast('Permisos actualizados', 'success');
      this.loadAdminUsers();
    } catch { this.showToast('Error actualizando permisos', 'error'); }
  }

  async deleteUser(userId) {
    if (!confirm('⚠️ ¿Eliminar usuario? Esta acción es IRREVERSIBLE.')) return;
    try {
      const res = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/users/${userId}`, {method:'DELETE'});
      if (!res.ok) throw new Error();
      this.showToast('Usuario eliminado', 'success');
      this.loadAdminUsers();
    } catch { this.showToast('Error eliminando usuario', 'error'); }
  }

  async revokeSession(sessionId) {
    if (!confirm('¿Revocar esta sesión?')) return;
    try {
      const res = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/sessions/${sessionId}`, {method:'DELETE'});
      if (!res.ok) throw new Error();
      this.showToast('Sesión revocada', 'success');
      this.loadAdminSessions();
    } catch { this.showToast('Error revocando sesión', 'error'); }
  }

  async adminForceCleanup() {
    if (!confirm('⚠️ Esto eliminará TODOS los archivos temporales. ¿Continuar?')) return;
    try {
      const res  = await authManager.fetchWithAuth(`${authManager.API_BASE}/api/admin/cleanup`, {method:'POST'});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.showToast('Limpieza completada', 'success');
      this.loadAdminStats();
    } catch (err) { this.showToast(`Error: ${err.message}`, 'error'); }
  }

  // ==========================================
  // UI HELPERS
  // ==========================================
  showLoading(show) {
    const el = document.getElementById('loadingSpinner');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  setStatus(text, color = '#00e5ff') {
    const el  = document.getElementById('statusText');
    const dot = document.getElementById('statusDot');
    if (el)  { el.textContent = text; el.style.color = color; }
    if (dot) dot.style.background = color;
  }

  showToast(message, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastIn 0.25s reverse ease-in';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
  }

  // ==========================================
  // INFINITE SCROLL (corregido)
  // ==========================================
  setupInfiniteScroll() {
    const container = document.querySelector('.results-container');
    if (!container) return;
    container.addEventListener('scroll', () => {
      if (this.isSearching || !this.currentSearchQuery || this.allResultsLoaded) return;
      // Cargar más cuando falten 200px para llegar al fondo
      const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (scrollBottom < 200) {
        this.executeSearch();
      }
    });
  }
}

// ==========================================
// BOOT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DynatubeApp();
});