// GET  /api/bloques?block=patrimonial -> [{month, col, value}]
// PUT  /api/bloques  { block, rows:[{month, col, value}] }
//
// Formato largo (una fila por celda) para que sirva a cualquier bloque
// sin tener que crear una tabla por hoja.
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';
import { recalcularMeses } from './_lib/recalc.js';

export const config = { runtime: 'edge' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const BLOQUES = new Set(['patrimonial', 'caja', 'activos', 'deuda']);
const MAX_FILAS = 2000;
const MAX_COL = 40;

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const block = url.searchParams.get('block') || '';
    if (!BLOQUES.has(block)) return json({ error: 'bloque_invalido' }, 400);
    const rows = await sql`
      SELECT month, col, value FROM bellesguard.block_monthly
      WHERE block = ${block} ORDER BY month, col`;
    return json({ block, rows });
  }

  if (request.method !== 'PUT') return json({ error: 'method' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const block = body.block || '';
  if (!BLOQUES.has(block)) return json({ error: 'bloque_invalido' }, 400);

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return json({ error: 'sin_filas' }, 400);
  if (rows.length > MAX_FILAS) return json({ error: 'demasiadas_filas', max: MAX_FILAS }, 400);

  for (const r of rows) {
    if (!MONTH_RE.test(r.month || '')) return json({ error: 'mes_invalido', month: r.month }, 400);
    if (!Number.isInteger(r.col) || r.col < 0 || r.col > MAX_COL) {
      return json({ error: 'columna_invalida', col: r.col }, 400);
    }
  }

  // Un solo viaje con arrays paralelos en vez de una consulta por celda.
  await sql`
    INSERT INTO bellesguard.block_monthly (block, month, col, value, updated_at)
    SELECT *, now() FROM UNNEST(
      ${rows.map(() => block)}::text[],
      ${rows.map((r) => r.month)}::text[],
      ${rows.map((r) => r.col)}::smallint[],
      ${rows.map((r) => num(r.value))}::float8[]
    )
    ON CONFLICT (block, month, col) DO UPDATE SET
      value = EXCLUDED.value, updated_at = now()`;

  // `series` es una vista del detalle: si cambia el detalle, hay que rehacerla.
  const recalculados = await recalcularMeses(rows.map((r) => r.month));

  return json({ ok: true, filas: rows.length, meses_recalculados: recalculados.length });
}
