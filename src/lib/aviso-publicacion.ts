// Aviso de publicación para el panel de Keystatic.
//
// EL PROBLEMA QUE RESUELVE, y no es menor:
//
// El cliente pulsa Guardar. El commit se hace, todo funciona, y la web no cambia
// hasta que el hosting reconstruye — un par de minutos. Durante ese rato Keystatic
// no dice nada, así que la persona cree que ha perdido el texto y vuelve a
// guardar. Cinco veces. Cinco commits, cinco reconstrucciones, y un mensaje
// diciendo "el CMS no funciona".
//
// Le pasó a quien montó este sistema, sabiendo cómo está construido por dentro y
// con la consola del navegador abierta: media hora pensando que estaba roto. A un
// cliente le va a pasar seguro.
//
// Es el único fallo del sistema que ocurre CUANDO TODO VA BIEN, en cada guardado,
// para siempre. Por eso vale la pena este fichero.
//
// NO ES UNA HIPÓTESIS. Al montar este sistema quedaron cinco commits seguidos
// sobre el mismo fichero, con minutos de diferencia: alguien guardando una y otra
// vez porque no veía confirmación. Cinco commits, cinco reconstrucciones.
//
// CÓMO FUNCIONA
//
// Keystatic no ofrece punto de extensión: `ui` solo acepta `brand` y `navigation`,
// `keystatic()` no admite opciones, y la ruta que inyecta gana sobre una propia.
// Apropiarse del panel exigiría replicar su integrador entero — un fork de sus
// internos, mala idea en algo que se va a clonar muchas veces.
//
// Lo que sí podemos: el panel es `client:only`, así que el HTML del servidor es
// una cáscara donde React monta. Un `<div>` hermano no le estorba. Insertamos este
// script antes de `</body>` desde el middleware, e interceptamos `fetch` para
// detectar la mutación `createCommitOnBranch`. No tocamos Keystatic: escuchamos.
//
// Y no nos quedamos en "tarda un par de minutos", que deja al cliente adivinando.
// Consultamos `/api/cms-estado`, que devuelve el commit del despliegue que está
// sirviendo: cuando cambia, el cambio ya está publicado de verdad.
//
// DEGRADA EN CADA CAPA, y eso es deliberado:
//   · si Keystatic cambia su forma de guardar → no avisa, pero no rompe nada
//   · si `/api/cms-estado` no existe o no hay sha → avisa "en un par de minutos"
//   · si el despliegue tarda más de 5 min → deja de esperar y lo dice
//
// DÓNDE VA: se inyecta en las rutas del panel. Ver la referencia del muro.

export const AVISO_PUBLICACION_JS = String.raw`
(function () {
  if (window.__avisoPublicacion) return;
  window.__avisoPublicacion = true;

  var CSS = [
    '#aviso-publicacion{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);',
    'z-index:2147483647;max-width:min(92vw,420px);display:flex;gap:12px;align-items:flex-start;',
    'padding:14px 16px;border-radius:12px;background:#17181b;color:#fff;border:1px solid #2a2c30;',
    'box-shadow:0 8px 32px rgba(0,0,0,.28);font:14px/1.45 system-ui,-apple-system,sans-serif;',
    'opacity:0;transition:opacity .18s ease,transform .18s ease}',
    '#aviso-publicacion[data-visible="true"]{opacity:1;transform:translateX(-50%) translateY(0)}',
    '#aviso-publicacion .ap-punto{width:8px;height:8px;border-radius:50%;background:#4ade80;margin-top:6px;flex:0 0 auto}',
    '#aviso-publicacion .ap-punto[data-estado="esperando"]{background:#fbbf24;animation:ap-latido 1.2s ease-in-out infinite}',
    '#aviso-publicacion .ap-punto[data-estado="listo"]{background:#4ade80}',
    '@keyframes ap-latido{0%,100%{opacity:1}50%{opacity:.35}}',
    '#aviso-publicacion .ap-enlace{display:inline-block;margin-top:6px;color:#8fa2ff;font-size:13px}',
    '@media (prefers-reduced-motion:reduce){#aviso-publicacion .ap-punto{animation:none}}',
    '#aviso-publicacion .ap-titulo{font-weight:600;margin:0 0 2px}',
    '#aviso-publicacion .ap-texto{margin:0;color:#b6bbc2;font-size:13px}',
    '#aviso-publicacion .ap-cerrar{margin-left:auto;background:none;border:0;color:#6b7076;cursor:pointer;',
    'font-size:18px;line-height:1;padding:0 2px}',
    '@media (prefers-reduced-motion:reduce){#aviso-publicacion{transition:none}}',
  ].join('');

  var caja, temporizador, sondeo, shaInicial;
  var INTERVALO = 5000;
  var MAX_ESPERA = 5 * 60 * 1000;

  function pedirSha() {
    return fetchOriginal('/api/cms-estado', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.sha ? d.sha : null; })
      .catch(function () { return null; });
  }

  function mostrar(titulo, texto, opciones) {
    if (!document.getElementById('aviso-publicacion-css')) {
      var s = document.createElement('style');
      s.id = 'aviso-publicacion-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'aviso-publicacion';
      caja.setAttribute('role', 'status');
      caja.setAttribute('aria-live', 'polite');
      document.body.appendChild(caja);
    }
    caja.innerHTML = '';
    opciones = opciones || {};

    var punto = document.createElement('span');
    punto.className = 'ap-punto';
    if (opciones.estado) punto.setAttribute('data-estado', opciones.estado);

    var cuerpo = document.createElement('div');
    var h = document.createElement('p');
    h.className = 'ap-titulo';
    h.textContent = titulo;
    var p = document.createElement('p');
    p.className = 'ap-texto';
    p.textContent = texto;
    cuerpo.appendChild(h);
    cuerpo.appendChild(p);

    var x = document.createElement('button');
    x.className = 'ap-cerrar';
    x.type = 'button';
    x.setAttribute('aria-label', 'Cerrar aviso');
    x.textContent = '\u00d7';
    x.onclick = ocultar;

    if (opciones.enlace) {
      var a = document.createElement('a');
      a.className = 'ap-enlace';
      a.href = '/';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'ver la web';
      cuerpo.appendChild(a);
    }

    caja.appendChild(punto);
    caja.appendChild(cuerpo);
    caja.appendChild(x);
    caja.setAttribute('data-visible', 'true');

    clearTimeout(temporizador);
    // Mientras se está publicando no se autooculta: el aviso ES el indicador.
    if (!opciones.persistente) temporizador = setTimeout(ocultar, 9000);
  }

  function esperarPublicacion() {
    clearInterval(sondeo);
    var desde = Date.now();

    mostrar('Guardado', 'Publicando el cambio en tu web\u2026', {
      estado: 'esperando',
      persistente: true,
    });

    sondeo = setInterval(function () {
      if (Date.now() - desde > MAX_ESPERA) {
        clearInterval(sondeo);
        mostrar(
          'Guardado',
          'Tu cambio est\u00e1 guardado, pero la web tarda m\u00e1s de lo normal en actualizarse. ' +
            'No hace falta que vuelvas a guardar.',
        );
        return;
      }
      pedirSha().then(function (actual) {
        if (actual && shaInicial && actual !== shaInicial) {
          clearInterval(sondeo);
          shaInicial = actual;
          mostrar('Publicado', 'Tu cambio ya se ve en la web.', {
            estado: 'listo',
            enlace: true,
          });
        }
      });
    }, INTERVALO);
  }

  function ocultar() {
    clearInterval(sondeo);
    if (caja) caja.setAttribute('data-visible', 'false');
  }

  var fetchOriginal = window.fetch.bind(window);

  // Sha del despliegue que sirve ahora. Si no lo hay, el aviso funciona igual
  // pero sin poder decir cuándo se ha publicado.
  pedirSha().then(function (s) { shaInicial = s; });

  window.fetch = function (entrada, opciones) {
    var esGuardado = false;
    try {
      var cuerpo = (opciones && opciones.body) || (entrada && entrada.body);
      if (typeof cuerpo === 'string' && cuerpo.indexOf('createCommitOnBranch') !== -1) {
        esGuardado = true;
      }
    } catch (e) {
      // Si no podemos inspeccionar el cuerpo, seguimos sin avisar. Nunca
      // interferimos con la petición.
    }

    var promesa = fetchOriginal.apply(this, arguments);
    if (!esGuardado) return promesa;

    return promesa.then(function (respuesta) {
      // Clonamos: leer el cuerpo original dejaría a Keystatic sin respuesta.
      respuesta
        .clone()
        .json()
        .then(function (datos) {
          if (datos && datos.errors && datos.errors.length) {
            mostrar(
              'No se ha podido guardar',
              'Recarga la página y vuelve a intentarlo. Si sigue igual, avisa a quien lleva la web.',
            );
          } else if (datos && datos.data && datos.data.createCommitOnBranch) {
            fetchOriginal('/api/cms-estado', { method: 'POST' }).catch(function () {});
            // Con sha conocido esperamos a que la web se reconstruya de verdad.
            // Sin él, el aviso de siempre: mejor impreciso que mudo.
            if (shaInicial) {
              esperarPublicacion();
            } else {
              mostrar(
                'Guardado',
                'Tu cambio estar\u00e1 publicado en un par de minutos. No hace falta que vuelvas a guardar.',
              );
            }
          }
        })
        .catch(function () {
          /* respuesta no legible: no avisamos */
        });
      return respuesta;
    });
  };
})();
`;
