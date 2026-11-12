export const prerender = false;
import type { APIContext, APIRoute } from 'astro';
import { COOKIES, CONFIG_MISSING, borrarCookieHeader, llamarApp, redirectHtml } from '../../lib/cms-app';

// Salir: el servicio cierra la sesión y retira la credencial de guardado que se
// dio con ella. Si no contesta, se sale igual: las cookies se borran siempre.
export async function cmsLogout(context: Pick<APIContext, 'cookies'>, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const sesion = context.cookies.get(COOKIES.SESION)?.value;
  if (sesion && !CONFIG_MISSING) await llamarApp('salir', { sesion }, fetchImpl);

  const res = redirectHtml('/acceso');
  res.headers.append('Set-Cookie', borrarCookieHeader(COOKIES.SESION));
  res.headers.append('Set-Cookie', borrarCookieHeader(COOKIES.GH));
  return res;
}

export const GET: APIRoute = (context) => cmsLogout(context);
export const POST: APIRoute = (context) => cmsLogout(context);
