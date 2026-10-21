// Muestra la barra de progreso real (mismo camino de código que usa la app) y
// comprueba su geometría frente al sidebar.
(() => {
  const sidebar = document.querySelector('.app-sidebar');
  const progress = document.getElementById('progress-bar-wrap');
  const main = document.getElementById('main-content');

  updateProgress({ stage: 'downloading', label: 'winget · Microsoft.VCLibs', percent: 42 });

  const s = sidebar.getBoundingClientRect();
  const p = progress.getBoundingClientRect();
  const m = main.getBoundingClientRect();

  const result = {
    visible: !progress.classList.contains('hidden'),
    sidebar: { left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top) },
    progress: {
      left: Math.round(p.left),
      right: Math.round(p.right),
      top: Math.round(p.top),
      bottom: Math.round(p.bottom),
      width: Math.round(p.width),
    },
    main: { left: Math.round(m.left), right: Math.round(m.right) },
    // La barra de progreso no debe invadir la zona del sidebar.
    overlapsSidebar: p.left < s.right,
    // Ni quedar por encima de la barra lateral en el eje vertical.
    coversSidebarArea: p.left < s.right && p.bottom > s.top && p.top < s.bottom,
    fillWidth: document.getElementById('progress-fill').style.width,
    stage: document.getElementById('progress-stage').textContent,
    label: document.getElementById('progress-label').textContent,
  };

  // Se deja la interfaz como estaba.
  document.getElementById('progress-bar-wrap').classList.add('hidden');
  document.getElementById('progress-fill').style.width = '0%';

  return JSON.stringify(result, null, 2);
})()
