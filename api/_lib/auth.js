// Sesiones firmadas con HMAC-SHA256. Sin dependencias, solo Web Crypto.
const COOKIE = 'bg_session';
const TTL = 60 * 60 * 24 * 7; // 7 días
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

export async function createSession(env) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + TTL })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function verifySession(token, env) {
  if (!token || !env.SESSION_SECRET) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64u(sig), enc.encode(payload));
  } catch {
    return false;
  }
  if (!ok) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
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
export async function requireAuth(request, env = process.env) {
  if (await verifySession(readCookie(request), env)) return null;
  return json({ error: 'no_auth' }, 401);
}

export const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  request.headers.get('x-real-ip') ||
  'unknown';
