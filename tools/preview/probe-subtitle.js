/*
  Comprueba en el WebView real que el recuento de pendientes se pinta como
  marcado y no como etiquetas visibles.

  Ejercita `afterRowsChanged()`, que es exactamente la función que corre al
  terminar de actualizar o ignorar una app. Antes usaba textContent, así que el
  `<span class="text-primary font-semibold">` aparecía literal en pantalla justo
  en ese momento (al abrir la app se veía bien porque el camino era otro).

  El subtítulo se restaura al terminar: la comprobación no deja la vista tocada.

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
    ./dist/SuperUpdater_0.1.0_portable.exe
    powershell -ExecutionPolicy Bypass -File tools/preview/cdp-eval.ps1 `
        -File tools/preview/probe-subtitle.js -Port 9223
*/
(function () {
  var subtitle = document.getElementById('subtitle');
  if (!subtitle) return JSON.stringify({ error: 'no hay subtítulo' });
  if (typeof afterRowsChanged !== 'function') {
    return JSON.stringify({ error: 'afterRowsChanged no está definida' });
  }

  var rows = document.querySelectorAll('#apps-container .app-row').length;
  var before = subtitle.innerHTML;

  afterRowsChanged();

  var text = subtitle.textContent.trim();
  var span = subtitle.querySelector('span.text-primary.font-semibold');
  var resultado = {
    rows: rows,
    before: before,
    after: subtitle.innerHTML,
    text: text,
    spanPresent: !!span,
    leakedTags: text.indexOf('<') !== -1,
    countMatchesRows: text.indexOf(String(rows) + ' ') === 0
  };

  subtitle.innerHTML = before;
  resultado.restored = subtitle.innerHTML === before;

  return JSON.stringify(resultado, null, 1);
})()
