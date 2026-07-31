import { checkPassword, createSession, sessionCookie, verifySession, readCookie, clientIp, json } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { runtime: 'edge' };

const MAX_FAILS = 8;
const LOCK_MIN = 15;

export default async function handler(request) {
  const env = process.env;

  if (request.method === 'GET') {
    return json({ authed: await verifySession(readCookie(request), env) });
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  if (!env.SESSION_SECRET || !env.APP_PASSWORD) return json({ error: 'server_misconfigured' }, 500);

  const ip = clientIp(request);

  const [row] = await sql`
    SELECT fails, EXTRACT(EPOCH FROM (now() - last_try)) / 60 AS mins
    FROM login_attempts WHERE ip = ${ip}`;

  if (row && row.fails >= MAX_FAILS && row.mins < LOCK_MIN) {
    return json({ error: 'locked', retry_in_min: Math.ceil(LOCK_MIN - row.mins) }, 429);
  }

  let password = '';
  try {
    ({ password } = await request.json());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (!(await checkPassword(password, env.APP_PASSWORD))) {
    const fails = row && row.mins < LOCK_MIN ? Number(row.fails) + 1 : 1;
    await sql`
      INSERT INTO login_attempts (ip, fails, last_try) VALUES (${ip}, ${fails}, now())
      ON CONFLICT (ip) DO UPDATE SET fails = ${fails}, last_try = now()`;
    // Retraso fijo, no depende de la contraseña: no filtra nada por tiempo.
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: 'bad_password', left: Math.max(0, MAX_FAILS - fails) }, 401);
  }

  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await createSession(env)) });
}
