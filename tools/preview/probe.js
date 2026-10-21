// Sonda de estado del WebView real de SuperUpdater.
// Se ejecuta con tools/preview/cdp-eval.ps1.
(() => {
  const main = document.getElementById('main-content');
  const title = document.getElementById('updates-title');
  const subtitle = document.getElementById('subtitle');
  const rows = Array.from(document.querySelectorAll('.app-row'));
  const progress = document.getElementById('progress-bar-wrap');
  const sidebar = document.querySelector('.app-sidebar');
  const titlebar = document.querySelector('.app-titlebar');

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const visibleRows = rows.filter(
    (r) => r.getBoundingClientRect().bottom > 0 && r.getBoundingClientRect().top < window.innerHeight
  );

  return JSON.stringify(
    {
      // Scroll: ¿qué contenedor se ha desplazado?
      mainScrollTop: main ? main.scrollTop : null,
      mainScrollHeight: main ? main.scrollHeight : null,
      mainClientHeight: main ? main.clientHeight : null,
      documentScrollTop: document.documentElement.scrollTop,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      bodyScrollTop: document.body.scrollTop,
      bodyScrollHeight: document.body.scrollHeight,
      windowScrollY: window.scrollY,

      // Contenido
      title: title ? title.textContent.trim() : null,
      titleRect: rect(title),
      titleVisible: title ? title.getBoundingClientRect().top >= 0 : null,
      subtitle: subtitle ? subtitle.textContent.trim() : null,
      rowCount: rows.length,
      visibleRowCount: visibleRows.length,
      firstRowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,

      // Geometría de la ventana
      titlebarRect: rect(titlebar),
      sidebarRect: rect(sidebar),
      mainRect: rect(main),
      progressRect: progress && !progress.classList.contains('hidden') ? rect(progress) : null,
      progressHidden: progress ? progress.classList.contains('hidden') : null,
      // Sólo tiene sentido con la barra visible: si está oculta su rect es 0x0.
      progressCoversSidebar:
        progress && !progress.classList.contains('hidden')
          ? progress.getBoundingClientRect().left < sidebar.getBoundingClientRect().right
          : null,

      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      activeElement: document.activeElement
        ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '')
        : null,
    },
    null,
    2
  );
})()
