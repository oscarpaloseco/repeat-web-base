export const prerender = false;
import type { APIContext, APIRoute } from 'astro';
import { COOKIES, CONFIG_MISSING, MURO_VERSION, env, llamarApp } from '../../lib/cms-app';

// GET: commit del despliegue que está sirviendo y versión del muro.
//
// Es la señal que convierte "tarda un par de minutos" en "ya está publicado": el
// aviso de guardado guarda este valor al cargar la página y lo consulta cada
// pocos segundos. Cuando cambia, el cambio ya se ve. Si no hay commit, devuelve
// null y el aviso degrada al mensaje de siempre.
//
// GET ?comprobar=<32 hex>: la comprobación de la web. Se le pasa el número al
// servicio de acceso, que así sabe que esta web tiene bien puestas sus variables.
//
// POST (con sesión): el aviso de guardado apunta en el servicio la hora del
// último guardado.

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };
const NONCE = /^[0-9a-f]{32}$/;

export async function cmsEstado(context: Pick<APIContext, 'url'>, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const cuerpo: { sha: string | null; muro: string; conectado?: boolean } = {
    sha: env('VERCEL_GIT_COMMIT_SHA') || null,
    muro: MURO_VERSION,
  };
  const comprobar = context.url.searchParams.get('comprobar');
  if (comprobar !== null) {
    cuerpo.conectado =
      NONCE.test(comprobar) && !CONFIG_MISSING && (await llamarApp('ping', { nonce: comprobar }, fetchImpl)).ok;
  }
  return new Response(JSON.stringify(cuerpo), {
    // Sin esto el navegador cachearía la respuesta y el aviso nunca vería el
    // cambio: se quedaría en "Publicando…" para siempre.
    headers: { 'Content-Type': 'application/json', ...NO_CACHE },
  });
}

export async function cmsGuardado(context: Pick<APIContext, 'cookies'>, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const sesion = context.cookies.get(COOKIES.SESION)?.value;
  if (!sesion) return new Response(null, { status: 401, headers: NO_CACHE });
  const r = await llamarApp('publicacion', { sesion }, fetchImpl);
  const status = r.ok ? 204 : r.error === 'sesion' ? 401 : 503;
  return new Response(null, { status, headers: NO_CACHE });
}

export const GET: APIRoute = (context) => cmsEstado(context);
export const POST: APIRoute = (context) => cmsGuardado(context);
