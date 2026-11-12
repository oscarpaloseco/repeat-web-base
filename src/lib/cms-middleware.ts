// Muro de acceso al editor. Protege /keystatic y /api/keystatic: sin sesión
// → /acceso; con sesión → pone la credencial de guardado para que Keystatic
// pueda guardar. Quien edita entra con email y contraseña; nunca ve nada más.
//
// Corre en Node, no en el edge: con el adaptador de Vercel, deja
// `edgeMiddleware` sin activar (es el valor por defecto).
//
// Las páginas públicas de la web no pasan por aquí: si el servicio de acceso
// se cae, la web sigue publicada y solo el editor deja de abrir.

import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { AVISO_PUBLICACION_JS } from './aviso-publicacion';
import {
  COOKIES,
  CONFIG_MISSING,
  MENSAJES,
  llamarApp,
  mensajeDe,
  safePath,
  valorDeCookie,
  type Resultado,
} from './cms-app';

const isCmsPage = (p: string) => p === '/keystatic' || p.startsWith('/keystatic/');
const isCmsApi = (p: string) => p.startsWith('/api/keystatic');

/**
 * La ruta decodificada (`/%6Beystatic` es `/keystatic`). `null` si la
 * codificación está rota: entonces se trata como ruta del editor (falla cerrado).
 */
function decodificar(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

// Rutas de Keystatic para su propio inicio de sesión. Con el muro no se usan:
// si llegaran a Keystatic, sin su configuración propia, darían un error 500.
const REFRESCO = '/api/keystatic/github/refresh-token';
const ENTRADA = '/api/keystatic/github/login';
const SIN_REPO = '/api/keystatic/github/repo-not-found';
const SALIDA = '/api/keystatic/github/logout';

type Contexto = Pick<APIContext, 'url' | 'cookies' | 'redirect' | 'request'>;

const texto = (status: number, mensaje: string) =>
  new Response(mensaje, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function borrarCookies(context: Contexto) {
  context.cookies.delete(COOKIES.SESION, { path: '/' });
  context.cookies.delete(COOKIES.GH, { path: '/' });
}

/** Página del panel a la que volver: `/keystatic/<from>` si `from` es una ruta limpia. */
function panelDesde(url: URL): string {
  const from = url.searchParams.get('from') || '';
  if (!from || from.startsWith('/') || from.includes('..') || from.includes('\\')) return '/keystatic';
  return safePath(`/keystatic/${from}`);
}

/**
 * Pide al servicio la credencial de guardado y la deja en la cookie que lee
 * Keystatic. Dar de baja a alguien lo echa AHORA: sin sesión viva no hay credencial.
 */
async function ponerCredencial(
  context: Contexto,
  sesion: string,
  fetchImpl: typeof fetch,
  renovar = false,
): Promise<Resultado<null>> {
  const cuerpo = renovar ? { sesion, renovar: true } : { sesion };
  const r = await llamarApp<{ token: string; expira_s: number }>('token', cuerpo, fetchImpl);
  if (!r.ok) return r;
  const { token, expira_s } = r.data;
  if (!valorDeCookie(token) || typeof expira_s !== 'number' || !(expira_s > 0)) {
    return { ok: false, status: 0, error: 'caida' };
  }
  context.cookies.set(COOKIES.GH, token, {
    // httpOnly NO: Keystatic lee esta cookie por JavaScript para poder guardar.
    // Si la marcas httpOnly, se ve el editor, se pulsa Guardar y no pasa nada.
    // El riesgo queda acotado: dura como mucho 1 h y solo abre este repositorio.
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    // La cookie caduca un minuto ANTES que la credencial: si la sobreviviera,
    // guardar fallaría en silencio. Al caducar, Keystatic pide otra (abajo).
    maxAge: Math.max(60, Math.floor(expira_s) - 60),
  });
  return { ok: true, data: null };
}

export async function muroCms(context: Contexto, next: MiddlewareNext, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const decodificada = decodificar(context.url.pathname);
  // Se compara sin mayúsculas: `/API/Keystatic` también pasa por aquí.
  const path = (decodificada ?? context.url.pathname).toLowerCase();
  // Con la codificación rota no se sabe qué ruta es: se pide sesión como en la API.
  const pagina = decodificada !== null && isCmsPage(path);
  if (decodificada !== null && !pagina && !isCmsApi(path)) return next();

  if (CONFIG_MISSING) return texto(503, MENSAJES.config);

  const sesion = context.cookies.get(COOKIES.SESION)?.value;

  // Keystatic quiere entrar por su cuenta (credencial caducada): de vuelta al
  // panel, que vuelve a pedir la credencial.
  if (path === ENTRADA || path === SIN_REPO) {
    const panel = path === ENTRADA ? panelDesde(context.url) : '/keystatic';
    if (!sesion) {
      context.cookies.delete(COOKIES.GH, { path: '/' });
      return context.redirect(`/acceso?next=${encodeURIComponent(panel)}`);
    }
    // El repositorio no responde a esta credencial (la configuración del editor
    // apunta a otro, o falta permiso). Volver al panel daría la misma
    // credencial y otra vez aquí, sin fin: se para y se dice.
    if (path === SIN_REPO) return texto(503, MENSAJES.github);
    // Keystatic viene aquí cuando GitHub rechaza la credencial que tiene (no
    // pide otra si la cookie sigue puesta). Volver al panel sin más daría la
    // misma credencial muerta y otra vez aquí: se pide una nueva antes.
    context.cookies.delete(COOKIES.GH, { path: '/' });
    const r = await ponerCredencial(context, sesion, fetchImpl, true);
    if (r.ok) return context.redirect(panel);
    if (r.error === 'sesion') {
      borrarCookies(context);
      return context.redirect(`/acceso?next=${encodeURIComponent(panel)}`);
    }
    // Sin redirigir: volver al panel sin credencial acabaría otra vez aquí.
    return texto(503, mensajeDe(r));
  }
  if (path === SALIDA) return context.redirect('/api/cms-logout');

  if (!sesion) {
    context.cookies.delete(COOKIES.GH, { path: '/' });
    if (!pagina) return texto(401, MENSAJES.sesion);
    // La vuelta es la ruta tal cual llegó: Keystatic distingue mayúsculas en los
    // nombres de colección, y la página de acceso la valida con safePath.
    return context.redirect(`/acceso?next=${encodeURIComponent(context.url.pathname)}`);
  }

  // Keystatic, al ver caducada su cookie, pide una nueva aquí y solo comprueba
  // que responda 200 y que la cookie aparezca. No llega nunca a Keystatic.
  if (path === REFRESCO) {
    // Solo POST, como lo pide Keystatic: una navegación desde otra web no crea credenciales.
    if (context.request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
    }
    // Una credencial nueva: la que Keystatic da por caducada no debe volver.
    const r = await ponerCredencial(context, sesion, fetchImpl, true);
    if (r.ok) return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    if (r.error === 'sesion') {
      borrarCookies(context);
      return texto(401, MENSAJES.sesion);
    }
    return texto(503, mensajeDe(r));
  }

  // Las demás llamadas internas del panel: basta con que la sesión siga viva.
  if (!pagina) {
    const r = await llamarApp<{ email: string }>('sesion', { sesion }, fetchImpl);
    if (r.ok) return next();
    if (r.error === 'sesion') {
      borrarCookies(context);
      return texto(401, MENSAJES.sesion);
    }
    return texto(503, mensajeDe(r));
  }

  // En la carga de la página se pide la credencial de guardado.
  const r = await ponerCredencial(context, sesion, fetchImpl);
  if (!r.ok) {
    // Solo una sesión que ya no vale echa a la persona. Una clave de la web mal
    // puesta también da 401, pero eso no es culpa suya: es «no disponible».
    if (r.error === 'sesion') {
      borrarCookies(context);
      return context.redirect('/acceso?error=' + encodeURIComponent(MENSAJES.sesion));
    }
    return texto(503, mensajeDe(r));
  }

  const respuesta = await next();

  // Aviso de publicación: sin esto, quien edita guarda, funciona, y no se
  // entera de nada hasta que la web se reconstruye un par de minutos después.
  // Ver lib/aviso-publicacion.ts.
  if ((respuesta.headers.get('Content-Type') || '').includes('text/html')) {
    try {
      const html = await respuesta.text();
      return new Response(html.replace('</body>', `<script>${AVISO_PUBLICACION_JS}</script></body>`), {
        status: respuesta.status,
        headers: respuesta.headers,
      });
    } catch {
      // Si algo falla aquí, el panel tiene que seguir funcionando: el aviso es
      // una mejora, no un requisito.
      console.error('[muro] no se pudo inyectar el aviso de publicación');
    }
  }

  return respuesta;
}

// En local (`astro dev`) Keystatic escribe ficheros directamente: no hay a quién
// pedirle contraseña ni credencial que poner.
export const onRequestMuro = defineMiddleware((context, next) =>
  import.meta.env.DEV ? next() : muroCms(context, next),
);
