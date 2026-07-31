import { clearCookie, json } from './_lib/auth.js';
export const config = { runtime: 'edge' };
export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
