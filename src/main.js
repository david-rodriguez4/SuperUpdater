const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const { listen } = window.__TAURI__.event;

const appWindow = getCurrentWindow();
// Los botones de la barra de título lo usan desde HTML inline.
window.appWindow = appWindow;

document.addEventListener('contextmenu', (e) => e.preventDefault());

let apps = [];
let installedApps = [];
let currentSection = 'updates';
let toastTimer = null;
let progressHideTimer = null;
let showSizes = false;
let sizesRequested = false;

// Contadores por sección: evitan que una respuesta lenta pise a una nueva.
const loadToken = { updates: 0, installed: 0, search: 0, ignored: 0, history: 0 };

const NAV_IDS = ['updates', 'installed', 'search', 'ignored', 'history', 'info'];

// ===== Utilidades =====

/**
 * Escapa el texto antes de insertarlo con innerHTML.
 * Los nombres e identificadores vienen de winget: sin escapar, un paquete con
 * un nombre malicioso podría inyectar HTML en la interfaz.
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorMessage(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Pinta el recuento de actualizaciones pendientes.
 *
 * La traducción incluye marcado (`<span class="text-primary …">`), así que hay
 * que insertarlo con innerHTML. Con textContent el usuario ve las etiquetas
 * literales: era lo que pasaba al terminar una actualización, porque ese camino
 * (afterRowsChanged) usaba setText mientras la carga inicial usaba innerHTML.
 *
 * Ambos caminos pasan por aquí para que no puedan volver a divergir.
 */
function renderUpdatesSubtitle(count) {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.innerHTML = t('updates_pending', count);
}

function show(el, visible) {
  if (el) el.classList.toggle('hidden', !visible);
}

/** Busca una fila por su identificador sin depender de selectores CSS. */
function findRow(container, id) {
  if (!container) return null;
  for (const child of container.children) {
    if (child.dataset && child.dataset.id === id) return child;
  }
  return null;
}

/** Formatea una fecha de la zona horaria local del usuario. */
function formatDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!m) return value;

  let date;
  if (m[7]) {
    date = new Date(value);
  } else {
    // Formato heredado "YYYY-MM-DD HH:MM": se interpreta como hora local.
    date = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  if (!date || Number.isNaN(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat(currentLang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return value;
  }
}

// ===== INIT =====

async function init() {
  document.getElementById('language-selector').value = getCurrentLanguage();
  document.documentElement.lang = getCurrentLanguage();
  updateUI();
  wireEvents();

  try {
    await listen('progress', ({ payload }) => updateProgress(payload));
  } catch (e) {
    console.error('No se pudo suscribir a los eventos de progreso:', e);
  }

  // Las tipografías locales se cargan de forma asíncrona: al cambiar el ancho
  // de las filas la lista puede desplazarse, así que se vuelve arriba cuando
  // el texto ya está maquetado.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(resetScroll).catch(() => {});
  }

  try {
    const hasWinget = await invoke('check_winget');
    if (!hasWinget) {
      showNoWinget();
      return;
    }
  } catch (e) {
    setLoading(false);
    showToast(t('toast_loading_error') + errorMessage(e), 'error');
    return;
  }

  loadUpgrades();
  loadAppInfo();
}

function showNoWinget() {
  setLoading(false);
  show(document.getElementById('section-updates'), false);
  show(document.getElementById('section-no-winget'), true);
}

async function loadAppInfo() {
  try {
    const info = await invoke('get_app_info');
    setText('info-version-value', 'v' + info.version);
    if (info.winget_version) {
      setText('info-platform-sub', t('info_winget_version', info.winget_version));
    }
  } catch (e) {
    console.error('No se pudo obtener la información de la app:', e);
  }
}

/** Delegación de eventos: un solo listener por contenedor en vez de uno por fila. */
function wireEvents() {
  // Sin manejadores inline: permite activar una CSP estricta (script-src 'self').
  document.addEventListener('click', (e) => {
    const winBtn = e.target.closest('[data-window-action]');
    if (winBtn) {
      const action = winBtn.dataset.windowAction;
      if (action === 'minimize') appWindow.minimize();
      else if (action === 'maximize') appWindow.toggleMaximize();
      else if (action === 'close') appWindow.close();
      return;
    }

    const navBtn = e.target.closest('[data-section]');
    if (navBtn) {
      showSection(navBtn.dataset.section);
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    switch (actionEl.dataset.action) {
      case 'refresh-upgrades':
        loadUpgrades();
        break;
      case 'refresh-installed':
        loadInstalled();
        break;
      case 'toggle-sizes':
        toggleSizes();
        break;
      case 'upgrade-selected':
        upgradeSelected();
        break;
      case 'clear-history':
        clearHistory();
        break;
      case 'hide-toast':
        hideToast();
        break;
      case 'install-winget':
        installWinget();
        break;
      default:
        break;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-filter]');
    if (!el) return;
    if (el.dataset.filter === 'apps') filterApps(el.value);
    else if (el.dataset.filter === 'installed') filterInstalled(el.value);
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'toggle-select-all') toggleSelectAll(el);
    else if (el.dataset.action === 'change-language') changeLanguage(el.value);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-role="search-form"]')) {
      e.preventDefault();
      searchApps();
    }
  });

  document.getElementById('apps-container').addEventListener('click', (e) => {
    const upgradeBtn = e.target.closest('.upgrade-btn');
    if (upgradeBtn) {
      const row = upgradeBtn.closest('[data-id]');
      const cb = row.querySelector('.app-checkbox');
      upgradeSingle(row.dataset.id, row.dataset.name, cb.dataset.version, cb.dataset.available);
      return;
    }
    const ignoreBtn = e.target.closest('.ignore-btn');
    if (ignoreBtn) {
      const row = ignoreBtn.closest('[data-id]');
      ignoreApp(row.dataset.id, row.dataset.name);
    }
  });

  document.getElementById('apps-container').addEventListener('change', (e) => {
    if (e.target.classList.contains('app-checkbox')) updateSelectAllState();
  });

  document.getElementById('installed-container').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    if (e.target.closest('.uninstall-btn')) {
      uninstallApp(row.dataset.id, row.dataset.name);
    } else if (e.target.closest('.repair-btn')) {
      repairApp(row.dataset.id, row.dataset.name);
    }
  });

  document.getElementById('search-results').addEventListener('click', (e) => {
    const btn = e.target.closest('.install-btn');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    installApp(row.dataset.id, row.dataset.name, btn);
  });

  document.getElementById('ignored-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.unignore-btn');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    unignoreApp(row.dataset.id, row.dataset.name);
  });
}

// ===== I18N =====

function changeLanguage(lang) {
  setLanguage(lang);
  document.documentElement.lang = lang;
  updateUI();
  if (currentSection === 'updates') {
    renderApps(apps);
  } else if (currentSection === 'installed') {
    renderInstalled(installedApps);
  } else {
    refreshSection();
  }
}

function updateUI() {
  // Barra lateral
  setText('nav-updates-text', t('nav_updates'));
  setText('nav-installed-text', t('nav_installed'));
  setText('nav-search-text', t('nav_search'));
  setText('nav-ignored-text', t('nav_ignored'));
  setText('nav-history-text', t('nav_history'));
  setText('nav-info-text', t('nav_info'));

  // Actualizaciones
  setText('updates-title', t('updates_title'));
  setText('loading-text', t('updates_querying'));
  setText('empty-title', t('updates_empty_title'));
  setText('empty-sub', t('updates_empty_sub'));
  setText('select-all-label', t('updates_select_all'));
  setText('upgrade-selected-btn', t('updates_selected_btn'));

  // Sin winget
  setText('winget-title', t('winget_title'));
  setText('winget-sub', t('winget_sub'));
  setText('winget-btn-text', t('winget_btn'));

  // Instaladas
  setText('installed-title', t('installed_title'));
  setText('installed-loading-text', t('installed_loading'));
  setText('installed-empty-text', t('installed_empty'));

  // Buscar
  setText('search-title', t('search_title'));
  setText('search-sub', t('search_sub'));
  setText('search-btn-text', t('search_btn'));
  setText('search-loading-text', t('search_loading'));
  setText('search-empty-text', t('search_empty'));

  // Ignorados
  setText('ignored-title', t('ignored_title'));
  setText('ignored-sub', t('ignored_sub'));
  setText('ignored-empty-text', t('ignored_empty'));

  // Historial
  setText('history-title', t('history_title'));
  setText('history-sub', t('history_sub'));
  setText('history-clear-text', t('history_clear'));
  setText('history-empty-text', t('history_empty'));

  // Configuración
  setText('info-title', t('info_title'));
  setText('info-subtitle', t('info_sub'));
  setText('info-lang-title', t('info_language'));
  setText('info-version-label', t('info_version'));
  setText('info-backend-label', t('info_backend'));
  setText('info-backend-sub', t('info_backend_sub'));
  setText('info-platform-label', t('info_platform'));
  setText('info-about-title', t('info_about_title'));
  const about = document.getElementById('info-about-text');
  if (about) about.innerHTML = t('info_about_text');

  // Marcadores de posición
  const filter = document.getElementById('search-input');
  if (filter) filter.placeholder = t('updates_filter');
  const installedFilter = document.getElementById('installed-filter');
  if (installedFilter) installedFilter.placeholder = t('installed_filter');
  const query = document.getElementById('search-query');
  if (query) query.placeholder = t('search_placeholder');
}

// ===== NAVEGACIÓN =====

function showSection(section) {
  currentSection = section;

  NAV_IDS.forEach((id) => {
    const navEl = document.getElementById('nav-' + id);
    const secEl = document.getElementById('section-' + id);
    const active = id === section;

    if (secEl) secEl.classList.toggle('hidden', !active);
    if (!navEl) return;

    navEl.classList.toggle('text-primary', active);
    navEl.classList.toggle('text-slate-500', !active);
    navEl.classList.toggle('font-bold', active);
    // El indicador de sección activa lo dibuja `box-shadow` en `.nav-item`
    // (a partir de `aria-current`). Antes se añadía `border-r-4`, que restaba
    // 4 px al fondo y dejaba la opción activa más estrecha que el resto.
    navEl.classList.toggle('bg-slate-200/50', active);
    if (active) {
      navEl.setAttribute('aria-current', 'page');
    } else {
      navEl.removeAttribute('aria-current');
    }
  });

  // Cada sección empieza por arriba.
  resetScroll();

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
  btn.innerHTML =
    '<span class="material-symbols-outlined text-[18px] animate-spin" aria-hidden="true">progress_activity</span> ' +
    esc(t('winget_installing_short'));
  show(status, true);
  status.textContent = t('winget_downloading');

  try {
    await invoke('install_winget');
    status.textContent = t('winget_done');
    btn.classList.add('hidden');
  } catch (e) {
    status.textContent = t('toast_error', errorMessage(e));
    btn.disabled = false;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[18px]" aria-hidden="true">download</span> ' + esc(t('winget_retry'));
  }
}

// ===== BARRA DE PROGRESO =====

function updateProgress({ stage, label, percent }) {
  const wrap = document.getElementById('progress-bar-wrap');
  const fill = document.getElementById('progress-fill');
  const labelEl = document.getElementById('progress-label');
  const stageEl = document.getElementById('progress-stage');
  const icon = document.getElementById('progress-icon');
  const track = document.getElementById('progress-track');

  const stageLabels = {
    downloading: t('progress_downloading'),
    verifying: t('progress_verifying'),
    installing: t('progress_installing'),
    done: t('progress_done'),
    error: t('progress_error'),
  };

  labelEl.textContent = label;
  stageEl.textContent = stageLabels[stage] || stage;
  fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  if (track) track.setAttribute('aria-valuenow', String(percent));

  if (stage === 'done' || stage === 'error') {
    icon.classList.remove('animate-spin');
    icon.textContent = stage === 'done' ? 'check_circle' : 'error';
    icon.className =
      'material-symbols-outlined text-[18px] ' + (stage === 'done' ? 'text-tertiary' : 'text-error');
    fill.className =
      'h-1.5 rounded-full transition-all duration-500 ' + (stage === 'done' ? 'bg-tertiary' : 'bg-error');
    clearTimeout(progressHideTimer);
    progressHideTimer = setTimeout(() => {
      wrap.classList.add('hidden');
      fill.style.width = '0%';
      fill.className = 'bg-primary h-1.5 rounded-full transition-all duration-500';
      icon.className = 'material-symbols-outlined text-primary text-[18px] animate-spin';
      icon.textContent = 'progress_activity';
      if (track) track.setAttribute('aria-valuenow', '0');
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
  const token = ++loadToken.updates;

  setLoading(true);
  show(document.getElementById('apps-container'), false);
  show(document.getElementById('empty-state'), false);
  show(document.getElementById('select-all-wrap'), false);
  setText('subtitle', t('updates_loading'));

  try {
    const list = await invoke('list_upgrades');
    if (token !== loadToken.updates) return; // respuesta obsoleta
    apps = list;
    renderApps(apps);
  } catch (e) {
    if (token !== loadToken.updates) return;
    setLoading(false);
    setText('subtitle', t('updates_loading'));
    showToast(t('toast_loading_error') + errorMessage(e), 'error');
  }
}

function renderApps(list) {
  setLoading(false);
  const container = document.getElementById('apps-container');

  if (!list || list.length === 0) {
    setText('subtitle', t('updates_all_good'));
    show(document.getElementById('empty-state'), true);
    show(container, false);
    show(document.getElementById('select-all-wrap'), false);
    return;
  }

  renderUpdatesSubtitle(list.length);

  show(document.getElementById('select-all-wrap'), true);
  show(document.getElementById('toggle-sizes-btn'), true);

  container.innerHTML = list
    .map(
      (app) => `
    <div class="app-row bg-surface-container-lowest rounded-xl p-1 flex items-center shadow-sm hover:shadow-md transition-shadow group" data-id="${esc(app.id)}" data-name="${esc(app.name || app.id)}">
      <div class="flex-1 flex items-center gap-6 px-6 py-4">
        <div class="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">package_2</span>
        </div>
        <div class="flex-1 grid grid-cols-4 gap-6 items-center min-w-0">
          <div class="col-span-1 min-w-0">
            <h3 class="text-sm font-bold text-on-surface font-headline leading-tight truncate">${esc(app.name || app.id)}</h3>
            <p class="text-[11px] text-outline font-medium tracking-wide mt-0.5 truncate">${esc(app.id)}</p>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-[10px] uppercase tracking-widest text-outline font-bold mb-1">${esc(t('col_current'))}</span>
            <span class="text-sm font-medium text-on-surface-variant tabular truncate">${esc(app.version || '—')}</span>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">${esc(t('col_available'))}</span>
            <span class="text-sm font-bold text-primary tabular truncate">${esc(app.available || '—')}</span>
            <span class="size-slot text-[10px] text-outline mt-0.5 tabular" data-slot="${esc(app.id)}"></span>
          </div>
          <div class="flex items-center justify-end gap-2">
            <input type="checkbox" class="app-checkbox accent-primary w-3.5 h-3.5" data-id="${esc(app.id)}" data-name="${esc(app.name || app.id)}" data-version="${esc(app.version)}" data-available="${esc(app.available)}" checked aria-label="${esc(t('select_app', app.name || app.id))}" />
            <button type="button" class="ignore-btn px-3 py-2.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-400 hover:text-error hover:border-error/30 transition-colors" title="${esc(t('btn_ignore'))}" aria-label="${esc(t('btn_ignore_named', app.name || app.id))}">
              <span class="material-symbols-outlined text-[15px]" aria-hidden="true">visibility_off</span>
            </button>
            <button type="button" class="upgrade-btn cta-gradient text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-primary/20 hover:opacity-90 transition-opacity active:scale-95 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[15px]" aria-hidden="true">system_update_alt</span>
              ${esc(t('btn_update'))}
            </button>
          </div>
        </div>
      </div>
    </div>`
    )
    .join('');

  show(container, true);
  show(document.getElementById('empty-state'), false);
  applyFilter('search-input', 'apps-container');
  updateSelectAllState();
  resetScroll();

  if (showSizes && !sizesRequested) loadSizes();
}

function filterApps(query) {
  applyFilter('search-input', 'apps-container');
}

/**
 * Filtra las filas visibles. Se recalcula el número de filas *visibles* para no
 * contar como "actualizadas" las que el filtro tiene ocultas.
 */
function applyFilter(inputId, containerId) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;
  const q = input.value.trim().toLowerCase();

  for (const row of container.children) {
    const name = (row.dataset.name || '').toLowerCase();
    const id = (row.dataset.id || '').toLowerCase();
    row.style.display = !q || name.includes(q) || id.includes(q) ? '' : 'none';
  }
}

function updateSelectAllState() {
  const master = document.getElementById('select-all');
  if (!master) return;
  const boxes = Array.from(document.querySelectorAll('.app-checkbox'));
  const checked = boxes.filter((b) => b.checked).length;
  master.checked = boxes.length > 0 && checked === boxes.length;
  master.indeterminate = checked > 0 && checked < boxes.length;
}

function toggleSelectAll(checkbox) {
  document.querySelectorAll('.app-checkbox').forEach((cb) => {
    cb.checked = checkbox.checked;
  });
  updateSelectAllState();
}

/**
 * Tamaños de descarga. Antes se pedía uno por app (una invocación, un proceso
 * de PowerShell, un winget show y una petición HTTP por cada fila), lo que
 * saturaba el equipo justo al abrir la aplicación.
 * Ahora es una única llamada y sólo si el usuario lo pide.
 */
function toggleSizes() {
  showSizes = !showSizes;
  const btn = document.getElementById('toggle-sizes-btn');
  if (btn) btn.setAttribute('aria-pressed', String(showSizes));
  if (!showSizes) {
    sizesRequested = false;
    document.querySelectorAll('.size-slot').forEach((el) => (el.textContent = ''));
    return;
  }
  renderApps(apps);
}

async function loadSizes() {
  if (!apps.length) return;
  sizesRequested = true;
  document.querySelectorAll('.size-slot').forEach((el) => (el.textContent = '…'));
  try {
    const sizes = await invoke('get_package_sizes', { ids: apps.map((a) => a.id) });
    for (const [id, size] of Object.entries(sizes || {})) {
      const el = document.querySelector(`.size-slot[data-slot="${CSS.escape(id)}"]`);
      if (el) el.textContent = size;
    }
    document.querySelectorAll('.size-slot').forEach((el) => {
      if (el.textContent === '…') el.textContent = '';
    });
  } catch (e) {
    document.querySelectorAll('.size-slot').forEach((el) => (el.textContent = ''));
    console.error('No se pudieron obtener los tamaños:', e);
  }
}

async function upgradeSingle(id, name, fromVersion, toVersion) {
  const container = document.getElementById('apps-container');
  const row = findRow(container, id);
  const btn = row ? row.querySelector('.upgrade-btn') : null;
  const ignoreBtn = row ? row.querySelector('.ignore-btn') : null;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[15px] animate-spin" aria-hidden="true">progress_activity</span> ' +
      esc(t('btn_updating'));
  }
  if (ignoreBtn) ignoreBtn.disabled = true;
  showToast(t('toast_updating', name), 'info');

  try {
    await invoke('upgrade_app', { id, name, fromVersion, toVersion });
    showToast(t('toast_updated', name), 'success');
    apps = apps.filter((a) => a.id !== id);
    if (row) row.remove();
    afterRowsChanged();
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">system_update_alt</span> ' +
        esc(t('btn_update'));
    }
    if (ignoreBtn) ignoreBtn.disabled = false;
  }
}

/** Recalcula el estado tras quitar filas (filtro, selección y estado vacío). */
function afterRowsChanged() {
  const container = document.getElementById('apps-container');
  const visible = Array.from(container.children).filter((r) => r.style.display !== 'none');

  if (visible.length === 0) {
    show(container, false);
    show(document.getElementById('empty-state'), true);
    show(document.getElementById('select-all-wrap'), false);
    setText('subtitle', t('updates_all_good'));
  } else {
    renderUpdatesSubtitle(visible.length);
  }
  updateSelectAllState();
}

async function upgradeSelected() {
  const checkboxes = Array.from(document.querySelectorAll('.app-checkbox:checked'));
  const items = checkboxes.map((cb) => ({
    id: cb.dataset.id,
    name: cb.dataset.name,
    fromVersion: cb.dataset.version,
    toVersion: cb.dataset.available,
  }));
  if (items.length === 0) return showToast(t('toast_no_selected'), 'error');

  const btn = document.getElementById('upgrade-selected-btn');
  btn.disabled = true;
  try {
    for (const { id, name, fromVersion, toVersion } of items) {
      await upgradeSingle(id, name, fromVersion, toVersion);
    }
  } finally {
    btn.disabled = false;
  }
}

// ===== IGNORADOS =====

async function ignoreApp(id, name) {
  try {
    await invoke('ignore_app', { id, name });
    showToast(t('toast_ignored', name), 'success');
    apps = apps.filter((a) => a.id !== id);
    const row = findRow(document.getElementById('apps-container'), id);
    if (row) row.remove();
    afterRowsChanged();
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  }
}

async function unignoreApp(id, name) {
  try {
    await invoke('unignore_app', { id });
    showToast(t('toast_restored', name || id), 'success');
    loadIgnored();
    loadUpgrades();
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  }
}

async function loadIgnored() {
  const token = ++loadToken.ignored;
  const list = document.getElementById('ignored-list');
  const empty = document.getElementById('ignored-empty');

  try {
    const ignored = await invoke('get_ignored');
    if (token !== loadToken.ignored) return;

    if (!ignored || ignored.length === 0) {
      list.innerHTML = '';
      show(empty, true);
      return;
    }
    show(empty, false);
    list.innerHTML = ignored
      .map(
        (app) => `
    <div class="app-row bg-surface-container-lowest rounded-xl flex items-center justify-between px-6 py-4 shadow-sm border border-slate-100" data-id="${esc(app.id)}" data-name="${esc(app.name || app.id)}">
      <div class="flex items-center gap-4 min-w-0">
        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-outline text-[20px]" aria-hidden="true">package_2</span>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-on-surface truncate">${esc(app.name || app.id)}</p>
          <p class="text-[11px] text-outline truncate">${esc(app.id)}</p>
        </div>
      </div>
      <button type="button" class="unignore-btn px-4 py-2 text-xs font-bold text-primary border border-primary/30 rounded-xl hover:bg-primary/10 transition-colors flex items-center gap-1.5 shrink-0">
        <span class="material-symbols-outlined text-[15px]" aria-hidden="true">visibility</span>
        ${esc(t('btn_restore'))}
      </button>
    </div>`
      )
      .join('');
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  }
}

// ===== HISTORIAL =====

async function loadHistory() {
  const token = ++loadToken.history;
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  try {
    const history = await invoke('get_history');
    if (token !== loadToken.history) return;

    if (!history || history.length === 0) {
      list.innerHTML = '';
      show(empty, true);
      return;
    }
    show(empty, false);
    list.innerHTML = history
      .map(
        (entry) => `
    <div class="app-row bg-surface-container-lowest rounded-xl flex items-center gap-6 px-6 py-4 shadow-sm border border-slate-100">
      <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-tertiary text-[20px]" aria-hidden="true">check_circle</span>
      </div>
      <div class="flex-1 grid grid-cols-4 gap-4 items-center min-w-0">
        <div class="col-span-1 min-w-0">
          <p class="text-sm font-bold text-on-surface truncate">${esc(entry.name || entry.id)}</p>
          <p class="text-[11px] text-outline truncate">${esc(entry.id)}</p>
        </div>
        <div class="min-w-0">
          <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${esc(t('col_previous'))}</span>
          <span class="text-sm text-on-surface-variant tabular truncate">${esc(entry.from_version || '—')}</span>
        </div>
        <div class="min-w-0">
          <span class="text-[10px] uppercase tracking-widest text-tertiary font-bold block mb-0.5">${esc(t('col_updated_to'))}</span>
          <span class="text-sm font-bold text-tertiary tabular truncate">${esc(entry.to_version || '—')}</span>
        </div>
        <div class="text-right shrink-0">
          <span class="text-xs text-outline tabular">${esc(formatDate(entry.date))}</span>
        </div>
      </div>
    </div>`
      )
      .join('');
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  }
}

async function clearHistory() {
  try {
    await invoke('clear_history');
    loadHistory();
    showToast(t('toast_history_cleared'), 'success');
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  }
}

// ===== BUSCAR E INSTALAR =====

async function searchApps() {
  const input = document.getElementById('search-query');
  const query = input.value.trim();
  if (!query) return;

  const token = ++loadToken.search;
  show(document.getElementById('search-results'), false);
  show(document.getElementById('search-empty'), false);
  show(document.getElementById('search-loading'), true);

  try {
    const results = await invoke('search_apps', { query });
    if (token !== loadToken.search) return;
    show(document.getElementById('search-loading'), false);

    if (!results || results.length === 0) {
      show(document.getElementById('search-empty'), true);
      return;
    }

    const container = document.getElementById('search-results');
    container.innerHTML = results
      .map(
        (app) => `
      <div class="app-row bg-surface-container-lowest rounded-xl flex items-center gap-6 px-6 py-4 shadow-sm border border-slate-100" data-id="${esc(app.id)}" data-name="${esc(app.name || app.id)}">
        <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">package_2</span>
        </div>
        <div class="flex-1 grid grid-cols-3 gap-4 items-center min-w-0">
          <div class="min-w-0">
            <p class="text-sm font-bold text-on-surface truncate">${esc(app.name || app.id)}</p>
            <p class="text-[11px] text-outline truncate">${esc(app.id)}</p>
          </div>
          <div class="min-w-0">
            <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${esc(t('col_version'))}</span>
            <span class="text-sm text-on-surface-variant tabular truncate">${esc(app.version || '—')}</span>
          </div>
          <div class="flex justify-end">
            <button type="button" class="install-btn cta-gradient text-white px-5 py-2 rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[15px]" aria-hidden="true">download</span>
              ${esc(t('btn_install'))}
            </button>
          </div>
        </div>
      </div>`
      )
      .join('');

    show(container, true);
  } catch (e) {
    if (token !== loadToken.search) return;
    show(document.getElementById('search-loading'), false);
    showToast(t('toast_search_error') + errorMessage(e), 'error');
  }
}

async function installApp(id, name, btn) {
  btn.disabled = true;
  btn.innerHTML =
    '<span class="material-symbols-outlined text-[15px] animate-spin" aria-hidden="true">progress_activity</span> ' +
    esc(t('btn_installing'));
  showToast(t('toast_installing', name), 'info');

  try {
    await invoke('install_app', { id });
    showToast(t('toast_installed', name), 'success');
    btn.innerHTML = '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">check</span> ' + esc(t('btn_installed'));
    btn.classList.remove('cta-gradient');
    btn.classList.add('bg-tertiary-container', 'text-on-tertiary-container');
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
    btn.disabled = false;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">download</span> ' + esc(t('btn_install'));
  }
}

// ===== APLICACIONES INSTALADAS =====

async function loadInstalled() {
  const token = ++loadToken.installed;

  show(document.getElementById('installed-container'), false);
  show(document.getElementById('installed-empty'), false);
  show(document.getElementById('installed-loading'), true);
  setText('installed-subtitle', t('installed_loading'));
  document.getElementById('installed-filter').value = '';

  try {
    const list = await invoke('list_installed');
    if (token !== loadToken.installed) return;
    show(document.getElementById('installed-loading'), false);
    installedApps = list || [];
    renderInstalled(installedApps);
  } catch (e) {
    if (token !== loadToken.installed) return;
    show(document.getElementById('installed-loading'), false);
    showToast(t('toast_installed_error') + errorMessage(e), 'error');
  }
}

function renderInstalled(list) {
  const container = document.getElementById('installed-container');

  if (!list || list.length === 0) {
    show(document.getElementById('installed-empty'), true);
    show(container, false);
    setText('installed-subtitle', t('installed_loading'));
    return;
  }

  const subtitle = document.getElementById('installed-subtitle');
  subtitle.innerHTML = t('installed_count', list.length);

  container.innerHTML = list
    .map(
      (app) => `
      <div class="app-row bg-surface-container-lowest rounded-xl p-1 flex items-center shadow-sm hover:shadow-md transition-shadow" data-id="${esc(app.id)}" data-name="${esc(app.name || app.id)}">
        <div class="flex-1 flex items-center gap-6 px-6 py-4">
          <div class="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">deployed_code</span>
          </div>
          <div class="flex-1 grid grid-cols-3 gap-6 items-center min-w-0">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-on-surface font-headline leading-tight truncate">${esc(app.name || app.id)}</h3>
              <p class="text-[11px] text-outline mt-0.5 truncate">${esc(app.id)}</p>
            </div>
            <div class="min-w-0">
              <span class="text-[10px] uppercase tracking-widest text-outline font-bold block mb-0.5">${esc(t('col_version'))}</span>
              <span class="text-sm text-on-surface-variant tabular truncate">${esc(app.version || '—')}</span>
            </div>
            <div class="flex items-center justify-end gap-2 shrink-0">
              <button type="button" class="repair-btn px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-primary/40 hover:text-primary transition-colors flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[15px]" aria-hidden="true">build</span>
                ${esc(t('btn_repair'))}
              </button>
              <button type="button" class="uninstall-btn px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-500 hover:border-error/40 hover:text-error transition-colors flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[15px]" aria-hidden="true">delete</span>
                ${esc(t('btn_uninstall'))}
              </button>
            </div>
          </div>
        </div>
      </div>`
    )
    .join('');

  show(container, true);
  applyFilter('installed-filter', 'installed-container');
  resetScroll();
}

function filterInstalled(query) {
  applyFilter('installed-filter', 'installed-container');
}

async function uninstallApp(id, name) {
  const container = document.getElementById('installed-container');
  const row = findRow(container, id);
  const btn = row ? row.querySelector('.uninstall-btn') : null;
  const repairBtn = row ? row.querySelector('.repair-btn') : null;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[15px] animate-spin" aria-hidden="true">progress_activity</span> ' +
      esc(t('btn_uninstalling'));
  }
  if (repairBtn) repairBtn.disabled = true;
  showToast(t('toast_uninstalling', name), 'info');

  try {
    await invoke('uninstall_app', { id });
    showToast(t('toast_uninstalled', name), 'success');
    installedApps = installedApps.filter((a) => a.id !== id);
    if (row) row.remove();
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">delete</span> ' + esc(t('btn_uninstall'));
    }
    if (repairBtn) repairBtn.disabled = false;
  }
}

async function repairApp(id, name) {
  const container = document.getElementById('installed-container');
  const row = findRow(container, id);
  const btn = row ? row.querySelector('.repair-btn') : null;
  const uninstallBtn = row ? row.querySelector('.uninstall-btn') : null;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[15px] animate-spin" aria-hidden="true">progress_activity</span> ' +
      esc(t('btn_repairing'));
  }
  if (uninstallBtn) uninstallBtn.disabled = true;
  showToast(t('toast_repairing', name), 'info');

  try {
    await invoke('repair_app', { id });
    showToast(t('toast_repaired', name), 'success');
  } catch (e) {
    showToast(t('toast_error', errorMessage(e)), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">build</span> ' + esc(t('btn_repair'));
    }
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

  icon.className = 'material-symbols-outlined text-[20px] ' + (colors[type] || colors.info);
  icon.textContent = icons[type] || icons.info;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4000);
}

function hideToast() {
  document.getElementById('status-toast').classList.add('hidden');
}

function setLoading(show_) {
  document.getElementById('loading').classList.toggle('hidden', !show_);
}

/**
 * Devuelve el área de contenido al inicio.
 *
 * Al repintar una lista, el navegador conserva la posición del scroll, así que
 * recargar las actualizaciones dejaba la vista a media lista y el usuario
 * creyendo que faltaban filas.
 */
function resetScroll() {
  const main = document.getElementById('main-content');
  if (main) main.scrollTop = 0;
}

document.addEventListener('DOMContentLoaded', init);
