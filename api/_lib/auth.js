// Sesiones firmadas con HMAC-SHA256. Sin dependencias, solo Web Crypto.
//
// Caducan por INACTIVIDAD: cada petición autenticada renueva la cookie 30 minutos más,
// con un tope absoluto de 12 horas desde el login por mucho que se renueve.
// Y llevan dentro un "epoch" que vive en la base: al subirlo, todas las sesiones mueren.
const COOKIE = 'bg_session';
const TTL = 60 * 30;            // 30 min sin tocarla y se cierra
const TTL_MAX = 60 * 60 * 12;   // tope duro desde el login
const enc = new TextEncoder();

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

// Comparación en tiempo constante: nunca sale antes por un byte distinto.
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkPassword(input, expected) {
  if (!expected) return false;
  // Comparamos digests, no las cadenas: iguala la longitud y no filtra el largo real.
  return timingSafeEqual(await sha256(input || ''), await sha256(expected));
}

// iat = cuándo se hizo login (no se renueva), exp = hasta cuándo vale sin tocarla, e = epoch de revocación.
export async function createSession(env, epoch = 0, iat = null) {
  const ahora = Math.floor(Date.now() / 1000);
  const datos = { exp: ahora + TTL, iat: iat || ahora, e: Number(epoch) || 0 };
  const payload = b64u(enc.encode(JSON.stringify(datos)));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload)));
  return `${payload}.${sig}`;
}

// Devuelve los datos de la sesión si es válida, o null. Comprueba firma, inactividad,
// tope absoluto y epoch. Si no se pasa epoch, no se comprueba la revocación.
export async function leerSession(token, env, epoch = null) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64u(sig), enc.encode(payload));
    if (!ok) return null;
    const d = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    const ahora = Math.floor(Date.now() / 1000);
    if (typeof d.exp !== 'number' || d.exp <= ahora) return null;              // inactividad
    if (typeof d.iat !== 'number' || d.iat + TTL_MAX <= ahora) return null;    // tope absoluto
    if (epoch !== null && (Number(d.e) || 0) !== (Number(epoch) || 0)) return null;  // revocada
    return d;
  } catch {
    return null;
  }
}

// Cookie renovada a partir de una sesión ya validada: mantiene iat y epoch.
export async function renovarCookie(datos, env) {
  return sessionCookie(await createSession(env, datos.e || 0, datos.iat));
}

export async function verifySession(token, env, epoch = null) {
  return (await leerSession(token, env, epoch)) !== null;
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

// ---- Helpers específicos de Vercel ----

// Devuelve null si hay sesión válida; si no, la Response 401 que hay que retornar.
// Con `epoch` comprueba además que la sesión no haya sido revocada.
export async function requireAuth(request, env = process.env, epoch = null) {
  if (await verifySession(readCookie(request), env, epoch)) return null;
  return json({ error: 'no_auth' }, 401);
}

// Igual, pero devuelve también la cookie renovada para colgarla de la respuesta.
export async function requireAuthRenovando(request, env = process.env, epoch = null) {
  const datos = await leerSession(readCookie(request), env, epoch);
  if (!datos) return { denied: json({ error: 'no_auth' }, 401), cookie: null };
  return { denied: null, cookie: await renovarCookie(datos, env) };
}

export const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  request.headers.get('x-real-ip') ||
  'unknown';
