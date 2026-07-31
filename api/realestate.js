// GET  /api/realestate -> detalle mensual por propiedad
// PUT  /api/realestate -> upsert de filas { rows: [{month, prop, renta, cuota, ibi, otros, valor, hipoteca}] }
import { requireAuth, json } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export const config = { runtime: 'edge' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CAMPOS = ['renta', 'cuota', 'ibi', 'otros', 'valor', 'hipoteca'];
const MAX_FILAS = 600;

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export default async function handler(request) {
  const denied = await requireAuth(request);
  if (denied) return denied;

  if (request.method === 'GET') {
    const rows = await sql`
      SELECT month, prop, renta, cuota, ibi, otros, valor, hipoteca
      FROM bellesguard.re_monthly ORDER BY month, prop`;
    return json({ rows });
  }

  if (request.method !== 'PUT') return json({ error: 'method' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: 'sin_filas' }, 400);
  if (rows.length > MAX_FILAS) return json({ error: 'demasiadas_filas', max: MAX_FILAS }, 400);

  for (const r of rows) {
    if (!MONTH_RE.test(r.month || '')) return json({ error: 'mes_invalido', month: r.month }, 400);
    if (!Number.isInteger(r.prop) || r.prop < 0 || r.prop > 20) {
      return json({ error: 'propiedad_invalida', prop: r.prop }, 400);
    }
  }

  // Una sola consulta con arrays paralelos: 384 filas en un viaje, no en 384.
  const cols = {
    month: rows.map((r) => r.month),
    prop: rows.map((r) => r.prop),
  };
  for (const c of CAMPOS) cols[c] = rows.map((r) => num(r[c]));

  await sql`
    INSERT INTO bellesguard.re_monthly (month, prop, renta, cuota, ibi, otros, valor, hipoteca, updated_at)
    SELECT * , now() FROM UNNEST(
      ${cols.month}::text[], ${cols.prop}::smallint[],
      ${cols.renta}::float8[], ${cols.cuota}::float8[], ${cols.ibi}::float8[],
      ${cols.otros}::float8[], ${cols.valor}::float8[], ${cols.hipoteca}::float8[]
    )
    ON CONFLICT (month, prop) DO UPDATE SET
      renta = EXCLUDED.renta, cuota = EXCLUDED.cuota, ibi = EXCLUDED.ibi,
      otros = EXCLUDED.otros, valor = EXCLUDED.valor, hipoteca = EXCLUDED.hipoteca,
      updated_at = now()`;

  return json({ ok: true, filas: rows.length });
}
