import { requireAuth, json } from './_lib/auth.js';
import { sql } from './_lib/db.js';
export const config = { runtime: 'edge' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function handler(request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  let month, body, source;
  try { ({ month, body, source = 'llm' } = await request.json()); }
  catch { return json({ error: 'bad_json' }, 400); }

  if (!MONTH_RE.test(month || '')) return json({ error: 'bad_month' }, 400);
  if (!body || !body.trim()) return json({ error: 'empty' }, 400);

  await sql`INSERT INTO notes (month, body, source, created_at)
            VALUES (${month}, ${body.slice(0, 8000)}, ${source === 'manual' ? 'manual' : 'llm'}, now())
            ON CONFLICT (month) DO UPDATE SET body = EXCLUDED.body, source = EXCLUDED.source, created_at = now()`;
  return json({ ok: true });
}
