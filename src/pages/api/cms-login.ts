export const prerender = false;
import type { APIContext, APIRoute } from 'astro';
import { CONFIG_MISSING, MENSAJES, ipDelVisitante, llamarApp, mensajeDe, redirectHtml, safePath, sesionCookieHeader, valorDeCookie } from '../../lib/cms-app';

// Entrar con email y contraseña. La comprobación, el tope de intentos y la
// sesión los lleva el servicio de acceso; aquí solo se guarda la cookie.
export async function cmsLogin(
  context: Pick<APIContext, 'request'> & Partial<Pick<APIContext, 'clientAddress'>>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const form = await context.request.formData().catch(() => new FormData());
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  // Tras entrar se vuelve a una página, nunca a una llamada interna del panel.
  const pedido = safePath(form.get('next'));
  const dest = pedido.startsWith('/api/') ? '/keystatic' : pedido;

  // `next` ya está saneado, así que reinyectarlo en la URL de error es seguro.
  const nextParam = `&next=${encodeURIComponent(dest)}`;
  const fail = (msg: string) => redirectHtml(`/acceso?error=${encodeURIComponent(msg)}${nextParam}`);

  if (CONFIG_MISSING) return fail(MENSAJES.config);
  if (!email || !password) return fail(MENSAJES.credenciales);

  // La IP del visitante viaja aparte: el servicio cuenta los intentos por IP.
  const r = await llamarApp<{ sesion: string; expira_s: number }>('entrar', { email, password }, fetchImpl, {
    ip: ipDelVisitante(context),
  });
  if (!r.ok) return fail(mensajeDe(r));
  if (!valorDeCookie(r.data.sesion) || typeof r.data.expira_s !== 'number') return fail(MENSAJES.caida);

  return redirectHtml(dest, { 'Set-Cookie': sesionCookieHeader(r.data.sesion, r.data.expira_s) });
}

export const POST: APIRoute = (context) => cmsLogin(context);
