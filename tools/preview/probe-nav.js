/*
  Mide las opciones del sidebar en el WebView real.

  Se usa con cdp-eval.ps1 para comprobar que las seis opciones ocupan lo mismo
  y que el indicador de la sección activa está dentro de la propia caja:

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
    ./dist/SuperUpdater_0.1.0_portable.exe
    powershell -ExecutionPolicy Bypass -File tools/preview/cdp-eval.ps1 `
        -File tools/preview/probe-nav.js
*/
(function () {
  var items = Array.prototype.slice.call(
    document.querySelectorAll('.app-sidebar [data-section]')
  );
  var boxes = items.map(function (el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      id: el.id,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      border: parseFloat(cs.borderRightWidth) || 0,
      active: el.getAttribute('aria-current') === 'page',
      indicator: cs.boxShadow.indexOf('inset') !== -1 && cs.boxShadow.indexOf('rgba(0, 0, 0, 0)') === -1
    };
  });

  var widths = boxes.map(function (b) { return b.w; });
  var heights = boxes.map(function (b) { return b.h; });

  return JSON.stringify({
    boxes: boxes,
    allSameWidth: widths.every(function (w) { return w === widths[0]; }),
    allSameHeight: heights.every(function (h) { return h === heights[0]; }),
    anyBorder: boxes.some(function (b) { return b.border > 0; }),
    actives: boxes.filter(function (b) { return b.active; }).map(function (b) { return b.id; }),
    indicators: boxes.filter(function (b) { return b.indicator; }).map(function (b) { return b.id; })
  }, null, 1);
})()
