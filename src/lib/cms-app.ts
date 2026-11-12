// Muro de acceso al editor (/keystatic) de esta web. Versión 1.1.0.
//
// Idea: la persona que edita entra con su email y su contraseña. Esta web no
// guarda usuarios, contraseñas ni claves de nada: se lo pregunta todo al
// servicio de acceso, desde el servidor, con sus dos variables:
//
//   CMS_SITE_ID   identificador de esta web en el servicio
//   CMS_SITE_KEY  su clave propia (una por web; la de otra web no sirve aquí)
//
// NO copies este fichero a mano ni lo cambies: se instala tal cual, y su huella
// se comprueba contra el manifiesto publicado. Si cambias algo, la comprobación
// dirá que la copia no es exacta.

export const MURO_VERSION = '1.1.0';
export const APP_URL = 'https://clientes.repeat.tools';

/** Tiempo máximo de espera al servicio. Pasado esto, el editor dice que no está disponible. */
const TIEMPO_MAX_MS = 8000;

// Lee una variable en build (import.meta.env) o, si no está, en runtime
// (las variables de la función en Vercel). Solo se leen las dos del muro y el
// commit del despliegue.
export function env(name: string): string {
  const enBuild = (import.meta.env as Record<string, unknown> | undefined)?.[name];
  if (typeof enBuild === 'string' && enBuild.trim() !== '') return enBuild.trim();
  const runtime = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return (runtime?.[name] ?? '').trim();
}

// SIN valor por defecto a propósito: un valor de otra web haría que esta
// aceptara sus sesiones. No lanzamos aquí: el middleware importa este fichero y
// un throw en la carga tumbaría también las páginas públicas. En su lugar
// exponemos la bandera y el muro responde 503 SOLO en las rutas del editor.
export const SITE_ID = env('CMS_SITE_ID');
export const SITE_KEY = env('CMS_SITE_KEY');
export const CONFIG_MISSING = SITE_ID === '' || SITE_KEY === '';

export const COOKIES = {
  SESION: 'cms_sesion',
  GH: 'keystatic-gh-access-token', // el nombre que Keystatic lee
};

// ---------------------------------------------------------------------------
// Rutas seguras
// ---------------------------------------------------------------------------

// Solo rutas internas: empieza por una barra, NUNCA por dos (`//evil.com` sería
// una URL protocol-relative, o sea, un redirect abierto), y solo con caracteres
// válidos de URL. Nada de comillas, `<`, `>`, espacios ni barras invertidas.
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

export function safePath(value: unknown, fallback = '/keystatic'): string {
  const s = typeof value === 'string' ? value : '';
  return SAFE_PATH.test(s) ? s : fallback;
}

export function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Redirección devuelta como 200 + redirect por cliente.
 *
 * Con middleware en Node bastaría un 303, pero así sigue funcionando aunque la
 * web acabe con el middleware en el edge, donde los 3xx de los endpoints se
 * pierden.
 *
 * La URL se valida ANTES de imprimirse: sin esto, un `?next=/"><script>` rompe
 * el atributo del meta refresh y se convierte en XSS. Y como la cookie de
 * guardado NO es httpOnly (Keystatic la lee por JS), ese XSS se lleva permiso
 * de escritura en el repositorio de la web durante una hora.
 */
export function redirectHtml(url: string, extraHeaders: Record<string, string> = {}): Response {
  const dest = safePath(url, '/acceso');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">` +
      `<meta http-equiv="refresh" content="0;url=${escapeAttr(dest)}">` +
      `<script>location.replace(${JSON.stringify(dest)})</script>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders } },
  );
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

const segundos = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Cookie de la sesión: solo la lee el servidor de esta web. */
export function sesionCookieHeader(token: string, maxAgeS: number): string {
  return `${COOKIES.SESION}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${segundos(maxAgeS)}`;
}

/** Borra una cookie. La de sesión se borra con los mismos atributos con que se puso. */
export function borrarCookieHeader(name: string): string {
  return name === COOKIES.SESION
    ? `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    : `${name}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;
}

/** Valores que salen del servicio y van a una cookie: sin espacios, `;` ni comillas. */
export const valorDeCookie = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,512}$/.test(v);

// ---------------------------------------------------------------------------
// Llamadas al servicio de acceso
// ---------------------------------------------------------------------------

export type Accion = 'invitacion' | 'crear-contrasena' | 'entrar' | 'salir' | 'sesion' | 'token' | 'publicacion' | 'ping';

export type Fallo = { ok: false; status: number; error: string; espera_s?: number };
export type Resultado<T> = { ok: true; data: T } | Fallo;

const CAIDA: Fallo = { ok: false, status: 0, error: 'caida' };

/** Errores del contrato del servicio y el estado con que llega cada uno. */
const ERRORES: Record<string, number> = {
  clave: 401,
  servidor: 500,
  invitacion: 400,
  corta: 400,
  existe: 409,
  credenciales: 401,
  espera: 429,
  sesion: 401,
  github: 409,
  github_error: 503,
};

/** Forma de una IPv4/IPv6 (solo esos caracteres, sin saltos de línea). */
const PARECE_IP = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Llama al servicio desde el servidor de la web. La clave solo viaja a APP_URL:
 * una redirección no se sigue. Red caída o más de 8 s → `caida`. Con `ip` (la
 * del visitante) el servicio cuenta los intentos por IP: así nadie bloquea el
 * editor de esta web a los demás.
 */
export async function llamarApp<T>(
  accion: Accion,
  cuerpo: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  extra: { ip?: string } = {},
): Promise<Resultado<T>> {
  if (CONFIG_MISSING) return { ok: false, status: 0, error: 'config' };
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MAX_MS);
  try {
    const res = await fetchImpl(`${APP_URL}/api/cms/v1/${accion}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SITE_KEY}`,
        'X-Cms-Site': SITE_ID,
        'X-Cms-Muro': MURO_VERSION,
        ...(extra.ip && PARECE_IP.test(extra.ip) ? { 'X-Cms-Client-Ip': extra.ip } : {}),
      },
      body: JSON.stringify(cuerpo),
      redirect: 'error',
      cache: 'no-store',
      signal: control.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    const objeto = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    if (res.ok) return res.status === 200 && objeto ? { ok: true, data: objeto as T } : CAIDA;
    // Solo cuenta un error del contrato con su estado. Cualquier otra cosa (un
    // 404 porque la dirección no responde, una página HTML, un 405…) es
    // «no disponible», nunca «contraseña incorrecta».
    const error = typeof objeto?.error === 'string' ? objeto.error : '';
    if (ERRORES[error] !== res.status) return { ok: false, status: res.status, error: 'caida' };
    const fallo: Fallo = { ok: false, status: res.status, error };
    if (typeof objeto?.espera_s === 'number' && Number.isFinite(objeto.espera_s)) fallo.espera_s = objeto.espera_s;
    return fallo;
  } catch {
    return CAIDA;
  } finally {
    clearTimeout(reloj);
  }
}

/** IP de quien visita esta web: la que da Astro o, si el adaptador no la da,
 *  la primera de `x-forwarded-for`. Vacía si no hay ninguna. */
export function ipDelVisitante(context: { request: Request; clientAddress?: string }): string {
  try {
    const ip = context.clientAddress;
    if (typeof ip === 'string' && ip.trim()) return ip.trim();
  } catch {
    // Algunos adaptadores lanzan si no conocen la IP.
  }
  const h = context.request.headers;
  return (h.get('x-real-ip') || (h.get('x-forwarded-for') ?? '').split(',')[0] || '').trim();
}

// ---------------------------------------------------------------------------
// Textos para quien edita
// ---------------------------------------------------------------------------

export const MENSAJES = {
  credenciales: 'Email o contraseña incorrectos',
  espera: 'Demasiados intentos. Espera {n} minutos.',
  invitacion: 'Invitación no válida o caducada',
  existe: 'Esa cuenta ya existe: entra con tu contraseña.',
  corta: 'La contraseña debe tener al menos 8 caracteres',
  distintas: 'Las contraseñas no coinciden',
  sesion: 'Tu acceso ya no está activo.',
  caida: 'El editor no está disponible ahora mismo. Tu web sigue publicada: inténtalo en unos minutos.',
  github: 'El editor todavía no está listo. Avisa a quien mantiene tu web.',
  config: 'Editor no disponible: falta configuración en este despliegue. Avisa a quien mantiene tu web.',
};

function mensajeEspera(esperaS: number | undefined): string {
  const n = Math.max(1, Math.ceil((esperaS ?? 60) / 60));
  return n === 1 ? 'Demasiados intentos. Espera 1 minuto.' : MENSAJES.espera.replace('{n}', String(n));
}

/** Texto de un fallo. Lo que no se reconoce (5xx, clave, red) es «no disponible». */
export function mensajeDe(r: { status?: number; error: string; espera_s?: number }): string {
  switch (r.error) {
    case 'credenciales':
    case 'invitacion':
    case 'existe':
    case 'corta':
    case 'distintas':
    case 'sesion':
    case 'config':
      return MENSAJES[r.error];
    case 'espera':
      return mensajeEspera(r.espera_s);
    // La web no puede editar (app desinstalada, repo cambiado): no se arregla solo.
    case 'github':
      return MENSAJES.github;
    // `github_error` (sin red, 5xx o límite) es pasajero: va con lo de «no disponible».
    default:
      return MENSAJES.caida;
  }
}

/**
 * La página de acceso solo enseña textos del propio muro: un enlace con
 * `?error=` inventado no puede poner allí lo que quiera.
 */
export function esMensajeDelMuro(texto: string): boolean {
  if (/^Demasiados intentos\. Espera \d{1,4} minutos?\.$/.test(texto)) return true;
  return Object.values(MENSAJES).includes(texto);
}
