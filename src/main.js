const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const { listen } = window.__TAURI__.event;
const appWindow = getCurrentWindow();

document.addEventListener('contextmenu', e => e.preventDefault());

let apps = [];
let installedApps = [];
let toastTimer = null;
let currentSection = 'updates';

const NAV_IDS = ['updates', 'installed', 'search', 'ignored', 'history', 'info'];

// ===== INIT =====

async function init() {
  document.getElementById('language-selector').value = getCurrentLanguage();
  updateUI();
  // Listen for progress events from upgrade_app
  listen('progress', ({ payload }) => updateProgress(payload));
  const hasWinget = await invoke('check_winget');
  if (!hasWinget) {
    setLoading(false);
    document.getElementById('section-updates').classList.add('hidden');
    document.getElementById('section-no-winget').classList.remove('hidden');
    return;
  }
  loadUpgrades();
}

// ===== I18N =====

function changeLanguage(lang) {
  setLanguage(lang);
  updateUI();
  if (apps.length > 0) renderApps(apps);
  if (installedApps.length > 0) renderInstalled(installedApps);
  if (currentSection !== 'updates' && currentSection !== 'installed') refreshSection();
}

function updateUI() {
  // Sidebar
  document.getElementById('nav-updates-text').textContent = t('nav_updates');
  document.getElementById('nav-installed-text').textContent = t('nav_installed');
  document.getElementById('nav-search-text').textContent = t('nav_search');
  document.getElementById('nav-ignored-text').textContent = t('nav_ignored');
  document.getElementById('nav-history-text').textContent = t('nav_history');
  document.getElementById('nav-info-text').textContent = t('nav_info');

  // Updates
  document.getElementById('updates-title').textContent = t('updates_title');
  document.getElementById('loading-text').textContent = t('updates_querying');
  document.getElementById('empty-title').textContent = t('updates_empty_title');
  document.getElementById('empty-sub').textContent = t('updates_empty_sub');
  document.getElementById('select-all-label').textContent = t('updates_select_all');
  document.getElementById('upgrade-selected-btn').textContent = t('updates_selected_btn');
  document.getElementById('search-input').placeholder = t('updates_filter');

  // No winget
  document.getElementById('winget-title').textContent = t('winget_title');
  document.getElementById('winget-sub').textContent = t('winget_sub');
  document.getElementById('winget-btn-text').textContent = t('winget_btn');

  // Installed
  document.getElementById('installed-title').textContent = t('installed_title');
  document.getElementById('installed-loading-text').textContent = t('installed_loading');
  document.getElementById('installed-empty-text').textContent = t('installed_empty');
  document.getElementById('installed-filter').placeholder = t('installed_filter');

  // Search
  document.getElementById('search-title').textContent = t('search_title');
  document.getElementById('search-sub').textContent = t('search_sub');
  document.getElementById('search-query').placeholder = t('search_placeholder');
  document.getElementById('search-btn-text').textContent = t('search_btn');
  document.getElementById('search-loading-text').textContent = t('search_loading');
  document.getElementById('search-empty-text').textContent = t('search_empty');

  // Ignored
  document.getElementById('ignored-title').textContent = t('ignored_title');
  document.getElementById('ignored-sub').textContent = t('ignored_sub');
  document.getElementById('ignored-empty-text').textContent = t('ignored_empty');

  // History
  document.getElementById('history-title').textContent = t('history_title');
  document.getElementById('history-sub').textContent = t('history_sub');
  document.getElementById('history-clear-text').textContent = t('history_clear');
  document.getElementById('history-empty-text').textContent = t('history_empty');

  // Config/Info
  document.getElementById('info-title').textContent = t('info_title');
  document.getElementById('info-subtitle').textContent = t('info_sub');
  document.getElementById('info-lang-title').textContent = t('info_language');
  document.getElementById('info-version-label').textContent = t('info_version');
  document.getElementById('info-backend-label').textContent = t('info_backend');
  document.getElementById('info-backend-sub').textContent = t('info_backend_sub');
  document.getElementById('info-platform-label').textContent = t('info_platform');
  document.getElementById('info-platform-sub').textContent = t('info_platform_sub');
  document.getElementById('info-about-title').textContent = t('info_about_title');
  document.getElementById('info-about-text').innerHTML = t('info_about_text');
}

// ===== NAVEGACIÓN =====

function showSection(section) {
  currentSection = section;
  NAV_IDS.forEach(id => {
    const navEl = document.getElementById('nav-' + id);
    const secEl = document.getElementById('section-' + id);
    const active = id === section;
    if (secEl) secEl.classList.toggle('hidden', !active);
    if (navEl) navEl.className = `flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors ${
      active ? 'text-primary font-bold border-r-4 border-primary bg-slate-200/50' : 'text-slate-500 hover:bg-slate-200/50'
    }`;
  });

  if (section === 'history') loadHistory();
  if (section === 'ignored') loadIgnored();
  if (section === 'installed') loadInstalled();
}

function refreshSection() {
  if (currentSection === 'updates') loadUpgrades();
  else if (currentSection === 'installed') loadInstalled();
  else if (currentSection === 'history') loadHistory();
  else if (currentSection === 'ignored') loadIgnored();
}

// ===== WINGET INSTALL =====

async function installWinget() {
  const btn = document.getElementById('btn-install-winget');
  const status = document.getElementById('winget-install-status');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Instalando...';
  status.textContent = t('winget_downloading');
  status.classList.remove('hidden');
  try {
    await invoke('install_winget');
    status.textContent = t('winget_done');
    btn.classList.add('hidden');
  } catch (e) {
    status.textContent = 'Error: ' + e;
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">download</span> ${t('winget_retry')}`;
  }
}

// ===== PROGRESS BAR =====

let progressHideTimer = null;

function updateProgress({ stage, label, percent }) {
  const wrap = document.getElementById('progress-bar-wrap');
  const fill = document.getElementById('progress-fill');
  const labelEl = document.getElementById('progress-label');
  const stageEl = document.getElementById('progress-stage');
  const icon = document.getElementById('progress-icon');

  const stageLabels = {
    downloading: t('progress_downloading'),
    verifying:   t('progress_verifying'),
    installing:  t('progress_installing'),
    done:        t('progress_done'),
    error:       t('progress_error'),
  };

  labelEl.textContent = label;
  stageEl.textContent = stageLabels[stage] || stage;
  fill.style.width = percent + '%';

  if (stage === 'done' || stage === 'error') {
    icon.classList.remove('animate-spin');
    icon.textContent = stage === 'done' ? 'check_circle' : 'error';
    icon.className = `material-symbols-outlined text-[18px] ${stage === 'done' ? 'text-tertiary' : 'text-error'}`;
    fill.className = `h-1.5 rounded-full transition-all duration-500 ${stage === 'done' ? 'bg-tertiary' : 'bg-error'}`;
    clearTimeout(progressHideTimer);
    progressHideTimer = setTimeout(() => {
      wrap.classList.add('hidden');
      fill.style.width = '0%';
      fill.className = 'bg-primary h-1.5 rounded-full transition-all duration-500';
      icon.className = 'material-symbols-outlined text-primary text-[18px] animate-spin';
      icon.textContent = 'progress_activity';
    }, 3000);
  } else {
    clearTimeout(progressHideTimer);
    icon.className = 'material-symbols-outlined text-primary text-[18px] animate-spin';
    icon.textContent = 'progress_activity';
    fill.className = 'bg-primary h-1.5 rounded-full transition-all duration-500';
    wrap.classList.remove('hidden');
  }
}

// ===== ACTUALIZACIONES =====

async function loadUpgrades() {
  setLoading(true);
  document.getElementById('apps-container').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('select-all-wrap').classList.add('hidden');
  document.getElementById('subtitle').textContent = t('updates_loading');

  try {
    apps = await invoke('list_upgrades');
    renderApps(apps);
  } catch (e) {
    setLoading(false);
    showToast(t('toast_loading_error') + e, 'error');
  }
}

function renderApps(list) {
  setLoading(false);
  const container = document.getElementById('apps-container');

  if (list.length === 0) {
    document.getElementById('subtitle').textContent = t('updates_all_good');
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  document.getElementById('subtitle').innerHTML = t('updates_pending', list.length);

  document.getElementById('select-all-wrap').classList.remove('hidden');

  container.innerHTML = list.map(app => `
    <div class="bg-surface-container-lowest rounded-xl p-1 flex items-center shadow-sm hover:shadow-md transition-shadow group" id="row-${CSS.escape(app.id)}" data-id="${app.id}" data-name="${app.name || app.id}">
      <div class="flex-1 flex items-center gap-6 px-6 py-4">
        <div class="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-primary text-[24px]">package_2</span>
        </div>
        <div class="flex-1 grid grid-cols-4 gap-6 items-center">
          <div class="col-span-1">
            <h3 class="text-sm font-bold text-on-surface font-headline leading-tight">${app.name || app.id}</h3>
            <p class="text-[11px] text-outline font-medium tracking-wide mt-0.5">${app.id}</p>
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] uppercase tracking-widest text-outline font-bold mb-1">${t('col_current')}</span>
            <span class="text-sm font-medium text-on-surface-variant">${app.version}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">${t('col_available')}</span>
            <span class="text-sm font-bold text-primary">${app.available}</span>
            <span id="size-${CSS.escape(app.id)}" class="text-[10px] text-outline mt-0.5"></span>
          </div>
          <div class="flex items-center justify-end gap-2">
            <input type="checkbox" class="app-checkbox accent-primary w-3.5 h-3.5" data-id="${app.id}" data-name="${app.name || app.id}" data-version="${app.version}" data-available="${app.available}" checked />
            <button class="ignore-btn px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-400 hover:text-error hover:border-error/30 transition-colors" title="Ignorar">
              <span class="material-symbols-outlined text-[15px]">visibility_off</span>
            </button>
            <button class="upgrade-btn cta-gradient text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-primary/20 hover:opacity-90 transition-opacity active:scale-95 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[15px]">system_update_alt</span>
              ${t('btn_update')}
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.upgrade-btn').forEach(btn => {
    const row = btn.closest('[data-id]');
    const cb = row.querySelector('.app-checkbox');
    btn.addEventListener('click', () => upgradeSingle(row.dataset.id, row.dataset.name, cb.dataset.version, cb.dataset.available));
  });

  container.querySelectorAll('.ignore-btn').forEach(btn => {
    const row = btn.closest('[data-id]');
    btn.addEventListener('click', () => ignoreApp(row.dataset.id, row.dataset.name));
  });

  container.classList.remove('hidden');

  // Load download sizes asynchronously
  list.forEach(app => {
    invoke('get_package_size', { id: app.id }).then(size => {
      const el = document.getElementById(`size-${CSS.escape(app.id)}`);
      if (el && size) el.textContent = size;
    });
  });
}


function filterApps(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#apps-container > div').forEach(row => {
    const name = (row.dataset.name || '').toLowerCase();
    const id = (row.dataset.id || '').toLowerCase();
    row.style.display = name.includes(q) || id.includes(q) ? '' : 'none';
  });
}

async function upgradeSingle(id, name, fromVersion, toVersion) {
  const row = document.getElementById('row-' + CSS.escape(id));
  const btn = row?.querySelector('.upgrade-btn');
  const ignoreBtn = row?.querySelector('.ignore-btn');

  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> ${t('btn_updating')}`; }
  if (ignoreBtn) ignoreBtn.disabled = true;
  showToast(t('toast_updating', name), 'info');

  try {
    await invoke('upgrade_app', { id, name, fromVersion, toVersion });
    showToast(t('toast_updated', name), 'success');
    apps = apps.filter(a => a.id !== id);
    if (row) row.remove();
    const remaining = document.querySelectorAll('#apps-container > div').length;
    if (remaining === 0) {
      document.getElementById('apps-container').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      document.getElementById('select-all-wrap').classList.add('hidden');
      document.getElementById('subtitle').textContent = t('updates_all_good');
    }
  } catch (e) {
    const msg = (typeof e === 'string' ? e : e?.message || JSON.stringify(e)).replace('operacin', 'operación');
    showToast(t('toast_error', msg), 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined text-[15px]">system_update_alt</span> ${t('btn_update')}`;
    }
    if (ignoreBtn) ignoreBtn.disabled = false;
  }
}

async function upgradeSelected() {
  const checkboxes = document.querySelectorAll('.app-checkbox:checked');
  const items = [...checkboxes].map(cb => ({ id: cb.dataset.id, name: cb.dataset.name, fromVersion: cb.dataset.version, toVersion: cb.dataset.available }));
  if (items.length === 0) return showToast(t('toast_no_selected'), 'error');
  for (const { id, name, fromVersion, toVersion } of items) await upgradeSingle(id, name, fromVersion, toVersion);
}

function toggleSelectAll(checkbox) {
  document.querySelectorAll('.app-checkbox').forEach(cb => cb.checked = checkbox.checked);
}

// ===== IGNORADOS =====

async function ignoreApp(id, name) {
  await invoke('ignore_app', { id, name });
  showToast(t('toast_ignored', name), 'success');
  apps = apps.filter(a => a.id !== id);
  const row = document.getElementById('row-' + CSS.escape(id));
  if (row) row.remove();
  const remaining = document.querySelectorAll('#apps-container > div').length;
  if (remaining === 0) {
    document.getElementById('apps-container').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('select-all-wrap').classList.add('hidden');
  }
}

async function loadIgnored() {
  const ignored = await invoke('get_ignored');
  const list = document.getElementById('ignored-list');
  const empty = document.getElementById('ignored-empty');

  if (ignored.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = ignored.map(app => `
    <div class="bg-surface-container-lowest rounded-xl flex items-center justify-between px-6 py-4 shadow-sm border border-slate-100" data-id="${app.id}" data-name="${app.name}">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center">
          <span class="material-symbols-outlined text-outline text-[20px]">package_2</span>
        </div>
        <div>
          <p class="text-sm font-medium text-on-surface">${app.name || app.id}</p>
          <p class="text-[11px] text-outline">${app.id}</p>
        </div>
      </div>
      <button class="unignore-btn px-4 py-2 text-xs font-bold text-primary border border-primary/30 rounded-xl hover:bg-primary/10 transition-colors flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[15px]">visibility</span>
        ${t('btn_restore')}
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.unignore-btn').forEach(btn => {
    const row = btn.closest('[data-id]');
    btn.addEventListener('click', async () => {
      await invoke('unignore_app', { id: row.dataset.id });
      showToast(t('toast_restored', row.dataset.name || row.dataset.id), 'success');
      loadIgnored();
      loadUpgrades();
    });
  });
}

// ===== HISTORIAL =====

async function loadHistory() {
  const history = await invoke('get_history');
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  if (history.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = history.map(entry => `
    <div class="bg-surface-container-lowest rounded-xl flex items-center gap-6 px-6 py-4 shadow-sm border border-slate-100">
      <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-tertiary text-[20px]">check_circle</span>
      </div>
      <div class="flex-1 grid grid-cols-4 gap-4 items-center">
        <div class="col-span-1">
          <p class="text-sm font-bold text-on-surface">${entry.name || entry.id}</p>
          <p class="text-[11px] text-outline">${entry.id}</p>
        </div>
        <div>
          <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${t('col_previous')}</span>
          <span class="text-sm text-on-surface-variant">${entry.from_version}</span>
        </div>
        <div>
          <span class="text-[10px] uppercase tracking-widest text-tertiary font-bold block mb-0.5">${t('col_updated_to')}</span>
          <span class="text-sm font-bold text-tertiary">${entry.to_version}</span>
        </div>
        <div class="text-right">
          <span class="text-xs text-outline">${entry.date}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function clearHistory() {
  await invoke('clear_history');
  loadHistory();
  showToast(t('toast_history_cleared'), 'success');
}

// ===== BUSCAR E INSTALAR =====

async function searchApps() {
  const query = document.getElementById('search-query').value.trim();
  if (!query) return;

  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-empty').classList.add('hidden');
  document.getElementById('search-loading').classList.remove('hidden');

  try {
    const results = await invoke('search_apps', { query });
    document.getElementById('search-loading').classList.add('hidden');

    if (results.length === 0) {
      document.getElementById('search-empty').classList.remove('hidden');
      return;
    }

    const container = document.getElementById('search-results');
    container.innerHTML = results.map(app => `
      <div class="bg-surface-container-lowest rounded-xl flex items-center gap-6 px-6 py-4 shadow-sm border border-slate-100" data-id="${app.id}" data-name="${app.name || app.id}">
        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-primary text-[20px]">package_2</span>
        </div>
        <div class="flex-1 grid grid-cols-3 gap-4 items-center">
          <div>
            <p class="text-sm font-bold text-on-surface">${app.name || app.id}</p>
            <p class="text-[11px] text-outline">${app.id}</p>
          </div>
          <div>
            <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${t('col_version')}</span>
            <span class="text-sm text-on-surface-variant">${app.version || '—'}</span>
          </div>
          <div class="flex justify-end">
            <button class="install-btn cta-gradient text-white px-5 py-2 rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[15px]">download</span>
              ${t('btn_install')}
            </button>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.install-btn').forEach(btn => {
      const row = btn.closest('[data-id]');
      btn.addEventListener('click', () => installApp(row.dataset.id, row.dataset.name, btn));
    });

    container.classList.remove('hidden');
  } catch (e) {
    document.getElementById('search-loading').classList.add('hidden');
    showToast(t('toast_search_error') + e, 'error');
  }
}

async function installApp(id, name, btn) {
  btn.disabled = true;
  btn.innerHTML = `<span class="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> ${t('btn_installing')}`;
  showToast(t('toast_installing', name), 'info');

  try {
    await invoke('install_app', { id });
    showToast(t('toast_installed', name), 'success');
    btn.innerHTML = `<span class="material-symbols-outlined text-[15px]">check</span> ${t('btn_installed')}`;
    btn.className = btn.className.replace('cta-gradient', 'bg-tertiary-container text-on-tertiary-container');
  } catch (e) {
    const msg = (typeof e === 'string' ? e : e?.message || JSON.stringify(e)).replace('operacin', 'operación');
    showToast(t('toast_error', msg), 'error');
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-[15px]">download</span> ${t('btn_install')}`;
  }
}

// ===== APLICACIONES INSTALADAS =====

async function loadInstalled() {
  document.getElementById('installed-container').classList.add('hidden');
  document.getElementById('installed-empty').classList.add('hidden');
  document.getElementById('installed-loading').classList.remove('hidden');
  document.getElementById('installed-subtitle').textContent = t('installed_loading');
  document.getElementById('installed-filter').value = '';

  try {
    const list = await invoke('list_installed');
    document.getElementById('installed-loading').classList.add('hidden');
    installedApps = list;
    renderInstalled(list);
  } catch (e) {
    document.getElementById('installed-loading').classList.add('hidden');
    showToast(t('toast_installed_error') + e, 'error');
  }
}

function renderInstalled(list) {
    if (list.length === 0) {
      document.getElementById('installed-empty').classList.remove('hidden');
      return;
    }

    document.getElementById('installed-subtitle').innerHTML = t('installed_count', list.length);

    const container = document.getElementById('installed-container');
    container.innerHTML = list.map(app => `
      <div class="bg-surface-container-lowest rounded-xl p-1 flex items-center shadow-sm hover:shadow-md transition-shadow" id="installed-row-${CSS.escape(app.id)}" data-id="${app.id}" data-name="${app.name || app.id}">
        <div class="flex-1 flex items-center gap-6 px-6 py-4">
          <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-primary text-[20px]">deployed_code</span>
          </div>
          <div class="flex-1 grid grid-cols-3 gap-6 items-center">
            <div>
              <h3 class="text-sm font-bold text-on-surface font-headline leading-tight">${app.name || app.id}</h3>
              <p class="text-[11px] text-outline mt-0.5">${app.id}</p>
            </div>
            <div>
              <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${t('col_version')}</span>
              <span class="text-sm text-on-surface-variant">${app.version || '—'}</span>
            </div>
            <div class="flex items-center justify-end gap-2">
              <button class="repair-btn px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-primary/40 hover:text-primary transition-colors flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[15px]">build</span>
                ${t('btn_repair')}
              </button>
              <button class="uninstall-btn px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-error/40 hover:text-error transition-colors flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[15px]">delete</span>
                ${t('btn_uninstall')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.uninstall-btn').forEach(btn => {
      const row = btn.closest('[data-id]');
      btn.addEventListener('click', () => uninstallApp(row.dataset.id, row.dataset.name));
    });

    container.querySelectorAll('.repair-btn').forEach(btn => {
      const row = btn.closest('[data-id]');
      btn.addEventListener('click', () => repairApp(row.dataset.id, row.dataset.name));
    });

    container.classList.remove('hidden');
}

function filterInstalled(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#installed-container > div').forEach(row => {
    const name = (row.dataset.name || '').toLowerCase();
    const id = (row.dataset.id || '').toLowerCase();
    row.style.display = name.includes(q) || id.includes(q) ? '' : 'none';
  });
}

async function uninstallApp(id, name) {
  const row = document.getElementById('installed-row-' + CSS.escape(id));
  const btn = row?.querySelector('.uninstall-btn');
  const repairBtn = row?.querySelector('.repair-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> ${t('btn_uninstalling')}`; }
  if (repairBtn) repairBtn.disabled = true;
  showToast(t('toast_uninstalling', name), 'info');

  try {
    await invoke('uninstall_app', { id });
    showToast(t('toast_uninstalled', name), 'success');
    installedApps = installedApps.filter(a => a.id !== id);
    if (row) row.remove();
  } catch (e) {
    const msg = (typeof e === 'string' ? e : e?.message || JSON.stringify(e)).replace('operacin', 'operación');
    showToast(t('toast_error', msg), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined text-[15px]">delete</span> ${t('btn_uninstall')}`; }
    if (repairBtn) repairBtn.disabled = false;
  }
}

async function repairApp(id, name) {
  const row = document.getElementById('installed-row-' + CSS.escape(id));
  const btn = row?.querySelector('.repair-btn');
  const uninstallBtn = row?.querySelector('.uninstall-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> ${t('btn_repairing')}`; }
  if (uninstallBtn) uninstallBtn.disabled = true;
  showToast(t('toast_repairing', name), 'info');

  try {
    await invoke('repair_app', { id });
    showToast(t('toast_repaired', name), 'success');
  } catch (e) {
    const msg = (typeof e === 'string' ? e : e?.message || JSON.stringify(e)).replace('operacin', 'operación');
    showToast(t('toast_error', msg), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined text-[15px]">build</span> ${t('btn_repair')}`; }
    if (uninstallBtn) uninstallBtn.disabled = false;
  }
}

// ===== TOAST =====

function showToast(msg, type = 'info') {
  const toast = document.getElementById('status-toast');
  const icon = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  const colors = { info: 'text-primary', success: 'text-tertiary', error: 'text-error' };
  const icons = { info: 'info', success: 'check_circle', error: 'error' };
  icon.className = `material-symbols-outlined text-[20px] ${colors[type]}`;
  icon.textContent = icons[type];
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  document.getElementById('status-toast').classList.add('hidden');
}

function setLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

document.addEventListener('DOMContentLoaded', init);
