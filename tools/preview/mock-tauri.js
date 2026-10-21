/**
 * Simulación de la API de Tauri para revisar la interfaz en un navegador.
 *
 * El binario real inyecta `window.__TAURI__`; aquí se emula con datos de
 * ejemplo para poder verificar el diseño (incluida la barra de progreso)
 * sin compilar la aplicación.
 */
(() => {
  const listeners = new Map();

  const UPGRADES = [
    { id: 'Anthropic.Claude', name: 'Claude', version: '1.15200.0.0', available: '2.42304.2' },
    { id: 'ElectronicArts.EADesktop', name: 'EA app', version: '13.796.0.6309', available: '13.809.0.6322' },
    { id: 'Git.Git', name: 'Git', version: '2.55.0.3', available: '2.55.0.5' },
    {
      id: 'Microsoft.DotNet.AspNetCore.8',
      name: 'Microsoft ASP.NET Core 8.0.31 - Shared Framework (x64)',
      version: '8.0.31',
      available: '8.0.32',
    },
    { id: 'Microsoft.VisualStudioCode', name: 'Microsoft Visual Studio Code (User)', version: '1.141.0', available: '1.142.0' },
    { id: 'VideoLAN.VLC', name: 'VLC media player', version: '3.0.23', available: '3.0.24' },
    { id: 'Google.Chrome', name: 'Google Chrome', version: '140.0.7339.0', available: '141.0.7390.0' },
  ];

  const INSTALLED = [
    { id: '7zip.7zip', name: '7-Zip 26.04 (x64)', version: '26.04', available: '' },
    { id: 'Microsoft.WindowsStore_8wekyb3d8bbwe', name: 'Microsoft Store', version: '22506.23006.0', available: '' },
    { id: 'ARP\\Machine\\X64\\Android Studio', name: 'Android Studio', version: '2025.3', available: '' },
    { id: 'MSIX\\Microsoft.XboxSpeechToTextOverlay_1.21.13002.0_x64__8wekyb3d8bbwe', name: 'Xbox Game Speech Window', version: '1.21.13002.0', available: '' },
  ];

  const SEARCH = [
    { id: 'XPDM1ZW6815MQM', name: 'VLC', version: 'Unknown', available: '' },
    { id: 'VideoLAN.VLC', name: 'VLC media player', version: '3.0.24', available: '' },
    { id: 'Cimbali.pympress', name: 'pympress', version: '1.8.6', available: '' },
  ];

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        await delay(120);
        switch (cmd) {
          case 'check_winget':
            return true;
          case 'get_app_info':
            return { version: '0.1.0', winget_version: 'v1.9.25200.1013' };
          case 'list_upgrades':
            return UPGRADES;
          case 'list_installed':
            return INSTALLED;
          case 'search_apps':
            return SEARCH;
          case 'get_history':
            return [
              {
                id: 'Git.Git',
                name: 'Git',
                from_version: '2.55.0.3',
                to_version: '2.55.0.5',
                date: '2026-10-18T09:41:00Z',
              },
            ];
          case 'get_ignored':
            return [{ id: 'Some.Package', name: 'Some Package' }];
          case 'get_package_sizes':
            return { 'Anthropic.Claude': '120.4 MB', 'Git.Git': '68.2 MB' };
          default:
            return null;
        }
      },
    },
    window: {
      getCurrentWindow: () => ({
        minimize: () => {},
        toggleMaximize: () => {},
        close: () => {},
      }),
    },
    event: {
      listen: async (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
        return () => {};
      },
      emit: (event, payload) => {
        (listeners.get(event) || []).forEach((h) => h({ event, payload }));
      },
    },
  };

  /** Dispara un evento de progreso desde la consola del navegador. */
  window.__mockProgress = (stage, label, percent) => {
    window.__TAURI__.event.emit('progress', { stage, label, percent });
  };
})();
