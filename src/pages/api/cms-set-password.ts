export const prerender = false;
import type { APIContext, APIRoute } from 'astro';
import { CONFIG_MISSING, MENSAJES, llamarApp, mensajeDe, redirectHtml, sesionCookieHeader, valorDeCookie } from '../../lib/cms-app';

// Crear la contraseña con la invitación personal. El email va dentro de la
// invitación y lo conoce el servicio: ni se elige por formulario, ni sirve el
// enlace de otra persona, ni el de otra web. Es de un solo uso.
export async function cmsSetPassword(context: Pick<APIContext, 'request'>, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const form = await context.request.formData().catch(() => new FormData());
  const invite = String(form.get('invite') || '');
  const password = String(form.get('password') || '');
  const password2 = String(form.get('password2') || '');

  const back = (msg: string) =>
    redirectHtml(`/acceso?invite=${encodeURIComponent(invite)}&error=${encodeURIComponent(msg)}`);
  const out = (msg: string) => redirectHtml('/acceso?error=' + encodeURIComponent(msg));

  if (CONFIG_MISSING) return out(MENSAJES.config);
  if (!invite || invite.length > 2000) return out(MENSAJES.invitacion);
  if (password.length < 8) return back(MENSAJES.corta);
  if (password !== password2) return back(MENSAJES.distintas);

  const r = await llamarApp<{ sesion: string; expira_s: number; email: string }>(
    'crear-contrasena',
    { invite, password },
    fetchImpl,
  );
  if (!r.ok) {
    // Invitación gastada o cuenta ya creada: fuera del formulario de invitación.
    if (r.error === 'invitacion' || r.error === 'existe') return out(mensajeDe(r));
    return back(mensajeDe(r));
  }
  if (!valorDeCookie(r.data.sesion) || typeof r.data.expira_s !== 'number') return back(MENSAJES.caida);

  return redirectHtml('/keystatic', { 'Set-Cookie': sesionCookieHeader(r.data.sesion, r.data.expira_s) });
}

export const POST: APIRoute = (context) => cmsSetPassword(context);
