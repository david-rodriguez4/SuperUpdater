let currentLang = localStorage.getItem('lang') || 'es';

const TRANSLATIONS = {
  en: {
    // Sidebar
    nav_updates: 'Updates',
    nav_installed: 'Installed',
    nav_search: 'Search apps',
    nav_ignored: 'Ignored',
    nav_history: 'History',
    nav_info: 'Settings',

    // Updates section
    updates_title: 'Software Inventory',
    updates_loading: 'Searching for updates...',
    updates_all_good: 'All software is up to date.',
    updates_pending: (n) => `<span class="text-primary font-semibold">${n} update${n > 1 ? 's' : ''}</span> pending approval.`,
    updates_filter: 'Filter...',
    updates_select_all: 'Select all',
    updates_selected_btn: 'Update selected',
    updates_querying: 'Querying winget...',
    updates_empty_title: 'Everything is up to date',
    updates_empty_sub: 'No updates available',
    col_current: 'Current',
    col_available: 'Available',
    btn_update: 'Update',
    btn_updating: 'Updating...',
    btn_ignore: 'Ignore',

    // Installed section
    installed_title: 'Installed applications',
    installed_loading: 'Loading...',
    installed_count: (n) => `<span class="text-primary font-semibold">${n}</span> installed applications.`,
    installed_filter: 'Filter...',
    installed_empty: 'No applications found',
    col_version: 'Version',
    btn_repair: 'Repair',
    btn_repairing: 'Repairing...',
    btn_uninstall: 'Uninstall',
    btn_uninstalling: 'Uninstalling...',

    // Search section
    search_title: 'Search applications',
    search_sub: 'Search and install any application available in winget.',
    search_placeholder: 'e.g. vlc, notepad++, firefox...',
    search_btn: 'Search',
    search_loading: 'Searching...',
    search_empty: 'No results found',
    btn_install: 'Install',
    btn_installing: 'Installing...',
    btn_installed: 'Installed',

    // Ignored section
    ignored_title: 'Ignored apps',
    ignored_sub: 'These apps will not appear in the updates list.',
    ignored_empty: 'No ignored applications',
    btn_restore: 'Restore',

    // History section
    history_title: 'History',
    history_sub: 'Record of completed updates.',
    history_clear: 'Clear history',
    history_empty: 'No updates recorded yet',
    col_previous: 'Previous',
    col_updated_to: 'Updated to',

    // Info section
    info_title: 'Settings',
    info_sub: 'Application configuration and details.',
    info_config: 'Configuration',
    info_version: 'Current version',
    info_backend: 'Backend',
    info_backend_sub: 'Tauri v2 + winget',
    info_platform: 'Platform',
    info_platform_sub: 'Requires winget installed',
    info_about_title: 'About',
    info_about_text: 'SuperUpdater is a desktop application for Windows that allows you to manage and update installed software using <span class="font-semibold text-primary">winget</span>, Microsoft\'s official package manager. Built with <span class="font-semibold">Tauri v2</span> and <span class="font-semibold">Rust</span> for maximum efficiency.',
    info_language: 'Language',

    // Progress bar
    progress_downloading: 'Downloading',
    progress_verifying: 'Verifying',
    progress_installing: 'Installing',
    progress_done: 'Done',
    progress_error: 'Error',

    // Winget missing
    winget_title: 'winget not found',
    winget_sub: 'The Windows package manager is not installed. SuperUpdater can install it automatically.',
    winget_btn: 'Install winget',
    winget_downloading: 'Downloading winget, this may take a few minutes...',
    winget_done: '✓ winget installed. Restart the application to continue.',
    winget_retry: 'Retry',

    // Toasts
    toast_loading_error: 'Error loading updates: ',
    toast_updating: (n) => `Updating ${n}...`,
    toast_updated: (n) => `✓ ${n} updated successfully`,
    toast_error: (m) => `Error: ${m}`,
    toast_ignored: (n) => `${n} added to ignored`,
    toast_restored: (n) => `${n} restored`,
    toast_history_cleared: 'History cleared',
    toast_installing: (n) => `Installing ${n}...`,
    toast_installed: (n) => `✓ ${n} installed successfully`,
    toast_uninstalling: (n) => `Uninstalling ${n}...`,
    toast_uninstalled: (n) => `✓ ${n} uninstalled successfully`,
    toast_repairing: (n) => `Repairing ${n}...`,
    toast_repaired: (n) => `✓ ${n} repaired successfully`,
    toast_no_selected: 'No apps selected',
    toast_search_error: 'Search error: ',
    toast_installed_error: 'Error loading applications: ',
  },

  es: {
    nav_updates: 'Actualizaciones',
    nav_installed: 'Instaladas',
    nav_search: 'Buscar apps',
    nav_ignored: 'Ignorados',
    nav_history: 'Historial',
    nav_info: 'Configuración',

    updates_title: 'Inventario de software',
    updates_loading: 'Buscando actualizaciones...',
    updates_all_good: 'Todo el software está al día.',
    updates_pending: (n) => `<span class="text-primary font-semibold">${n} actualización${n > 1 ? 'es' : ''}</span> pendiente${n > 1 ? 's' : ''} de aprobación.`,
    updates_filter: 'Filtrar...',
    updates_select_all: 'Seleccionar todo',
    updates_selected_btn: 'Actualizar seleccionados',
    updates_querying: 'Consultando winget...',
    updates_empty_title: 'Todo está actualizado',
    updates_empty_sub: 'No se encontraron actualizaciones disponibles',
    col_current: 'Actual',
    col_available: 'Disponible',
    btn_update: 'Actualizar',
    btn_updating: 'Actualizando...',
    btn_ignore: 'Ignorar',

    installed_title: 'Aplicaciones instaladas',
    installed_loading: 'Cargando...',
    installed_count: (n) => `<span class="text-primary font-semibold">${n}</span> aplicaciones instaladas.`,
    installed_filter: 'Filtrar...',
    installed_empty: 'No se encontraron aplicaciones',
    col_version: 'Versión',
    btn_repair: 'Reparar',
    btn_repairing: 'Reparando...',
    btn_uninstall: 'Desinstalar',
    btn_uninstalling: 'Desinstalando...',

    search_title: 'Buscar aplicaciones',
    search_sub: 'Busca e instala cualquier aplicación disponible en winget.',
    search_placeholder: 'ej. vlc, notepad++, firefox...',
    search_btn: 'Buscar',
    search_loading: 'Buscando...',
    search_empty: 'No se encontraron resultados',
    btn_install: 'Instalar',
    btn_installing: 'Instalando...',
    btn_installed: 'Instalado',

    ignored_title: 'Apps ignoradas',
    ignored_sub: 'Estas aplicaciones no aparecerán en la lista de actualizaciones.',
    ignored_empty: 'No hay aplicaciones ignoradas',
    btn_restore: 'Restaurar',

    history_title: 'Historial',
    history_sub: 'Registro de actualizaciones realizadas.',
    history_clear: 'Limpiar historial',
    history_empty: 'Aún no hay actualizaciones registradas',
    col_previous: 'Anterior',
    col_updated_to: 'Actualizado a',

    info_title: 'Configuración',
    info_sub: 'Configuración y detalles de la aplicación.',
    info_config: 'Configuración',
    info_version: 'Versión actual',
    info_backend: 'Backend',
    info_backend_sub: 'Tauri v2 + winget',
    info_platform: 'Plataforma',
    info_platform_sub: 'Requiere winget instalado',
    info_about_title: 'Acerca de',
    info_about_text: 'SuperUpdater es una aplicación de escritorio para Windows que permite gestionar y actualizar el software instalado usando <span class="font-semibold text-primary">winget</span>, el gestor de paquetes oficial de Microsoft. Desarrollada con <span class="font-semibold">Tauri v2</span> y <span class="font-semibold">Rust</span> para máxima eficiencia.',
    info_language: 'Idioma',

    // Progress bar
    progress_downloading: 'Descargando',
    progress_verifying: 'Verificando',
    progress_installing: 'Instalando',
    progress_done: 'Completado',
    progress_error: 'Error',

    winget_title: 'winget no encontrado',
    winget_sub: 'El gestor de paquetes de Windows no está instalado. SuperUpdater puede instalarlo automáticamente.',
    winget_btn: 'Instalar winget',
    winget_downloading: 'Descargando winget, esto puede tardar unos minutos...',
    winget_done: '✓ winget instalado. Reinicia la aplicación para continuar.',
    winget_retry: 'Reintentar',

    toast_loading_error: 'Error al obtener actualizaciones: ',
    toast_updating: (n) => `Actualizando ${n}...`,
    toast_updated: (n) => `✓ ${n} actualizado correctamente`,
    toast_error: (m) => `Error: ${m}`,
    toast_ignored: (n) => `${n} agregado a ignorados`,
    toast_restored: (n) => `${n} restaurado`,
    toast_history_cleared: 'Historial limpiado',
    toast_installing: (n) => `Instalando ${n}...`,
    toast_installed: (n) => `✓ ${n} instalado correctamente`,
    toast_uninstalling: (n) => `Desinstalando ${n}...`,
    toast_uninstalled: (n) => `✓ ${n} desinstalado correctamente`,
    toast_repairing: (n) => `Reparando ${n}...`,
    toast_repaired: (n) => `✓ ${n} reparado correctamente`,
    toast_no_selected: 'No hay apps seleccionadas',
    toast_search_error: 'Error en la búsqueda: ',
    toast_installed_error: 'Error al cargar aplicaciones: ',
  }
};

function t(key, param) {
  const value = TRANSLATIONS[currentLang][key];
  return typeof value === 'function' ? value(param) : value || key;
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
}

function getCurrentLanguage() {
  return currentLang;
}
