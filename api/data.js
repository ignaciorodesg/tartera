import { requireAuth, json } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { runtime: 'edge' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export default async function handler(request) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  if (request.method === 'GET') return read();
  if (request.method === 'PUT') return write(request);
  return json({ error: 'method' }, 405);
}

async function read() {
  const [series, properties, meta, notes] = await Promise.all([
    sql`SELECT month, net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt, is_actual
        FROM series ORDER BY month`,
    sql`SELECT id, name, use_type, value, debt FROM properties ORDER BY sort, id`,
    sql`SELECT key, value FROM meta`,
    sql`SELECT month, body, source, created_at FROM notes ORDER BY month DESC LIMIT 24`,
  ]);

  return json({
    series: series.map((r) => ({ ...r, is_actual: r.is_actual ? 1 : 0 })),
    properties,
    meta: Object.fromEntries(meta.map((r) => [r.key, r.value])),
    notes,
  });
}

async function write(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  for (const r of body.series || []) {
    if (!MONTH_RE.test(r.month || '')) return json({ error: 'bad_month', month: r.month }, 400);
  }

  let written = 0;

  for (const r of body.series || []) {
    await sql`
      INSERT INTO series (month, net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt, is_actual, updated_at)
      VALUES (${r.month}, ${num(r.net)}, ${num(r.real_estate)}, ${num(r.patrimonial)}, ${num(r.empresas)},
              ${num(r.inv_fin)}, ${num(r.caja)}, ${num(r.activos)}, ${num(r.debt)}, ${!!r.is_actual}, now())
      ON CONFLICT (month) DO UPDATE SET
        net = EXCLUDED.net, real_estate = EXCLUDED.real_estate, patrimonial = EXCLUDED.patrimonial,
        empresas = EXCLUDED.empresas, inv_fin = EXCLUDED.inv_fin, caja = EXCLUDED.caja,
        activos = EXCLUDED.activos, debt = EXCLUDED.debt, is_actual = EXCLUDED.is_actual,
        updated_at = now()`;
    written++;
  }

  for (const p of body.properties || []) {
    const name = String(p.name || '').slice(0, 80);
    const use = String(p.use_type || '').slice(0, 60);
    if (p.deleted && p.id) {
      await sql`DELETE FROM properties WHERE id = ${p.id}`;
    } else if (p.id) {
      await sql`UPDATE properties SET name = ${name}, use_type = ${use},
                value = ${num(p.value)}, debt = ${num(p.debt)}, updated_at = now() WHERE id = ${p.id}`;
    } else {
      await sql`INSERT INTO properties (name, use_type, value, debt, sort)
                VALUES (${name}, ${use}, ${num(p.value)}, ${num(p.debt)}, ${p.sort || 99})`;
    }
    written++;
  }

  for (const [k, v] of Object.entries(body.meta || {})) {
    await sql`INSERT INTO meta (key, value) VALUES (${String(k).slice(0, 60)}, ${String(v).slice(0, 500)})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    written++;
  }

  return json({ ok: true, written });
}
