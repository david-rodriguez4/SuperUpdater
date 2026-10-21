/**
 * Comprobaciones automáticas del harness.
 *
 * El proyecto no tiene un runner de JavaScript (no hay Node ni un navegador
 * headless disponibles en el entorno), así que el harness hace de banco de
 * pruebas: al abrirlo se ejecutan estas aserciones sobre la interfaz real y
 * el resultado queda en `window.__selfcheck` y en la consola.
 *
 * Cubre los tres fallos que se han reportado:
 *   1. Pluralización en español ("actualizaciónes" en vez de "actualizaciones").
 *   2. La barra de progreso tapada por el sidebar.
 *   3. El aviso flotante solapado con la barra de progreso.
 *   4. Opciones del sidebar de tamaños distintos (el resaltado del hover
 *      medía lo que medía cada etiqueta).
 *   5. El recuento de pendientes mostraba las etiquetas HTML literales después
 *      de actualizar una app (el repintado usaba textContent).
 *
 * Para ejecutarlo:
 *   powershell -ExecutionPolicy Bypass -File tools/preview/serve.ps1
 *   abrir http://localhost:8731/tools/preview/harness.html
 *   en la consola: __selfcheck
 */
(function () {
  'use strict';

  const results = [];

  function check(name, ok, detail) {
    results.push({ name: name, ok: !!ok, detail: detail || '' });
  }

  /** Quita las etiquetas: las traducciones devuelven HTML con <span>. */
  function plain(html) {
    return String(html).replace(/<[^>]+>/g, '').trim();
  }

  // ===== 1. Pluralización =====

  function checkPlurals() {
    const casos = [
      ['es', 0, '0 actualizaciones pendientes de aprobación.'],
      ['es', 1, '1 actualización pendiente de aprobación.'],
      ['es', 2, '2 actualizaciones pendientes de aprobación.'],
      ['es', 14, '14 actualizaciones pendientes de aprobación.'],
      ['es', 16, '16 actualizaciones pendientes de aprobación.'],
      ['en', 0, '0 updates pending approval.'],
      ['en', 1, '1 update pending approval.'],
      ['en', 2, '2 updates pending approval.'],
      ['en', 16, '16 updates pending approval.'],
    ];

    const anterior = getCurrentLanguage();
    for (const [lang, n, esperado] of casos) {
      setLanguage(lang);
      const obtenu = plain(t('updates_pending', n));
      check(
        'plural updates_pending ' + lang + ' n=' + n,
        obtenu === esperado,
        'esperado "' + esperado + '", obtenido "' + obtenu + '"'
      );
    }

    // La forma singular de "aplicaciones instaladas" también debe existir.
    const instaladas = [
      ['es', 1, '1 aplicación instalada.'],
      ['es', 6, '6 aplicaciones instaladas.'],
      ['en', 1, '1 installed application.'],
      ['en', 6, '6 installed applications.'],
    ];
    for (const [lang, n, esperado] of instaladas) {
      setLanguage(lang);
      const obtenu = plain(t('installed_count', n));
      check(
        'plural installed_count ' + lang + ' n=' + n,
        obtenu === esperado,
        'esperado "' + esperado + '", obtenido "' + obtenu + '"'
      );
    }

    setLanguage(anterior);
  }

  // ===== 2 y 3. Disposición =====

  function checkLayout() {
    const sidebar = document.querySelector('.app-sidebar');
    const barra = document.getElementById('progress-bar-wrap');
    const aviso = document.getElementById('status-toast');
    if (!sidebar || !barra || !aviso) {
      check('la interfaz tiene sidebar, barra de progreso y aviso', false, 'falta algún elemento');
      return;
    }

    // Se muestran los dos para poder medirlos.
    const barraOculta = barra.classList.contains('hidden');
    const avisoOculto = aviso.classList.contains('hidden');
    barra.classList.remove('hidden');
    aviso.classList.remove('hidden');
    if (!document.getElementById('toast-msg').textContent) {
      document.getElementById('toast-msg').textContent = 'Comprobación';
    }

    const s = sidebar.getBoundingClientRect();
    const p = barra.getBoundingClientRect();
    const a = aviso.getBoundingClientRect();

    check(
      'la barra de progreso no la tapa el sidebar',
      p.left >= s.right - 1,
      'progress.left=' + Math.round(p.left) + ' sidebar.right=' + Math.round(s.right)
    );
    check(
      'la barra de progreso es visible',
      p.width > 0 && p.height > 0,
      'ancho=' + Math.round(p.width) + ' alto=' + Math.round(p.height)
    );
    check(
      'el aviso no se solapa con la barra de progreso',
      a.bottom <= p.top + 1,
      'aviso.bottom=' + Math.round(a.bottom) + ' progress.top=' + Math.round(p.top)
    );

    if (barraOculta) barra.classList.add('hidden');
    if (avisoOculto) aviso.classList.add('hidden');
  }

  // ===== 4. Opciones del sidebar =====

  /*
    Los <button> se ajustan a su contenido (shrink-to-fit) aunque lleven
    `display: flex`, así que sin fijar el ancho cada opción medía lo que su
    texto y el resaltado del hover cambiaba de tamaño de una a otra. También se
    comprueba que ninguna use `border-right` como indicador: el borde resta
    ancho al fondo y haría la opción activa más estrecha que las demás.
  */
  function checkNavItems() {
    const items = Array.prototype.slice.call(
      document.querySelectorAll('.app-sidebar [data-section]')
    );
    if (items.length < 2) {
      check('el sidebar tiene opciones que medir', false, 'encontradas ' + items.length);
      return;
    }

    const cajas = items.map(function (el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id: el.id,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        right: Math.round(r.right * 10) / 10,
        borde: parseFloat(cs.borderRightWidth) || 0
      };
    });
    const muestra = cajas.map((c) => c.id + ' ' + c.w + 'x' + c.h).join(', ');
    const iguales = (clave) => cajas.every((c) => c[clave] === cajas[0][clave]);

    check('todas las opciones del sidebar tienen el mismo ancho', iguales('w'), muestra);
    check('todas las opciones del sidebar tienen el mismo alto', iguales('h'), muestra);
    check('todas las opciones del sidebar acaban en el mismo borde', iguales('right'), muestra);

    const conBorde = cajas.filter((c) => c.borde > 0);
    check(
      'ninguna opción reserva un borde que estreche el resaltado',
      conBorde.length === 0,
      conBorde.map((c) => c.id + '=' + c.borde + 'px').join(', ')
    );
  }

  // ===== 5. El recuento se pinta como marcado, no como texto =====

  /*
    El subtítulo se repinta también al terminar de actualizar o ignorar una app
    (afterRowsChanged), no solo al cargar la lista. Ese camino usaba textContent
    y dejaba ver literalmente `<span class="text-primary font-semibold">`.

    Se ejercita la función real con dos filas de prueba, en lugar de comprobar
    solo la traducción: el fallo estaba en el camino de repintado.
  */
  function checkSubtitleRendering() {
    const container = document.getElementById('apps-container');
    const subtitle = document.getElementById('subtitle');
    const empty = document.getElementById('empty-state');
    const selectAll = document.getElementById('select-all-wrap');

    if (!container || !subtitle || !empty || !selectAll) {
      check('el subtítulo de actualizaciones existe', false, 'falta algún elemento');
      return;
    }
    if (typeof afterRowsChanged !== 'function') {
      check('afterRowsChanged es accesible', false, 'no está definida');
      return;
    }

    const filasPrevias = Array.prototype.slice.call(container.children);
    const estado = {
      subtitle: subtitle.innerHTML,
      container: container.className,
      empty: empty.className,
      selectAll: selectAll.className,
      lang: getCurrentLanguage()
    };

    try {
      setLanguage('es');
      container.innerHTML = '';
      for (let n = 1; n <= 2; n++) {
        const row = document.createElement('div');
        row.className = 'app-row';
        row.dataset.id = 'selfcheck.' + n;
        row.dataset.name = 'Selfcheck ' + n;
        container.appendChild(row);
      }

      // Mismo camino que se ejecuta justo después de actualizar una app.
      afterRowsChanged();

      const texto = subtitle.textContent.trim();
      const span = subtitle.querySelector('span.text-primary.font-semibold');

      check(
        'el recuento se pinta como HTML y no como etiquetas visibles',
        !!span && texto.indexOf('<') === -1,
        'texto="' + texto + '"'
      );
      check(
        'el recuento tras actualizar coincide con las filas que quedan',
        texto === '2 actualizaciones pendientes de aprobación.',
        'texto="' + texto + '"'
      );
    } finally {
      container.innerHTML = '';
      filasPrevias.forEach(function (row) { container.appendChild(row); });
      subtitle.innerHTML = estado.subtitle;
      container.className = estado.container;
      empty.className = estado.empty;
      selectAll.className = estado.selectAll;
      setLanguage(estado.lang);
      if (typeof updateSelectAllState === 'function') updateSelectAllState();
    }
  }

  // ===== Ejecución =====

  function run() {
    try {
      checkPlurals();
    } catch (e) {
      check('las comprobaciones de plural se ejecutan', false, String(e));
    }
    try {
      checkLayout();
    } catch (e) {
      check('las comprobaciones de disposición se ejecutan', false, String(e));
    }
    try {
      checkSubtitleRendering();
    } catch (e) {
      check('las comprobaciones del subtítulo se ejecutan', false, String(e));
    }
    try {
      checkNavItems();
    } catch (e) {
      check('las comprobaciones del sidebar se ejecutan', false, String(e));
    }

    const fallidos = results.filter((r) => !r.ok);
    window.__selfcheck = {
      passed: results.length - fallidos.length,
      failed: fallidos.length,
      total: results.length,
      results: results
    };

    for (const r of results) {
      if (r.ok) {
        console.log('[selfcheck OK]   ' + r.name);
      } else {
        console.error('[selfcheck FAIL] ' + r.name + ' -> ' + r.detail);
      }
    }
    if (fallidos.length === 0) {
      console.log('[selfcheck] ' + results.length + '/' + results.length + ' comprobaciones correctas');
    } else {
      console.error('[selfcheck] ' + fallidos.length + ' de ' + results.length + ' comprobaciones fallan');
    }
  }

  if (document.readyState === 'complete') {
    setTimeout(run, 50);
  } else {
    window.addEventListener('load', function () { setTimeout(run, 50); });
  }
})();
