// POST /api/sesiones  -> cierra todas las sesiones abiertas, incluida la que hace la llamada.
// Sube el contador que va firmado dentro de cada cookie: todas dejan de validar a la vez.
import { requireAuth, clearCookie, json } from './_lib/auth.js';
import { sessionEpoch, subirSessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const epoch = await subirSessionEpoch();
  return json({ ok: true, epoch }, 200, { 'Set-Cookie': clearCookie() });
}
