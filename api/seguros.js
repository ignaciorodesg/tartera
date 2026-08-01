// GET    /api/seguros          -> lista
// POST   /api/seguros          -> alta { concepto, fecha, importe, ... }
// PUT    /api/seguros          -> edición { id, campo: valor }
// DELETE /api/seguros?id=123   -> baja
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODOS = new Set(['Anual', 'Semestral', 'Trimestral', 'Mensual', 'Único']);

const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const rows = await sql`
      SELECT id, fecha::text, concepto, asegurado, banco, periodicidad, importe, meses, estado
      FROM bellesguard.seguros ORDER BY fecha DESC NULLS LAST, id DESC`;
    return json({ rows });
  }

  if (request.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`DELETE FROM bellesguard.seguros WHERE id = ${id}`;
    return json({ ok: true });
  }

  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const fecha = txt(b.fecha, 10);
  if (fecha && !FECHA_RE.test(fecha)) return json({ error: 'fecha_invalida' }, 400);

  const periodicidad = PERIODOS.has(b.periodicidad) ? b.periodicidad : 'Anual';
  const meses = Number.isInteger(b.meses) && b.meses >= 0 && b.meses <= 600 ? b.meses : 12;

  if (request.method === 'POST') {
    const concepto = txt(b.concepto);
    if (!concepto) return json({ error: 'concepto_vacio' }, 400);
    const [row] = await sql`
      INSERT INTO bellesguard.seguros (fecha, concepto, asegurado, banco, periodicidad, importe, meses, estado)
      VALUES (${fecha || null}, ${concepto}, ${txt(b.asegurado)}, ${txt(b.banco, 40)},
              ${periodicidad}, ${num(b.importe)}, ${meses}, ${txt(b.estado, 20)})
      RETURNING id`;
    return json({ ok: true, id: row.id });
  }

  if (request.method === 'PUT') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    const concepto = txt(b.concepto);
    if (!concepto) return json({ error: 'concepto_vacio' }, 400);
    await sql`
      UPDATE bellesguard.seguros SET
        fecha = ${fecha || null}, concepto = ${concepto}, asegurado = ${txt(b.asegurado)},
        banco = ${txt(b.banco, 40)}, periodicidad = ${periodicidad}, importe = ${num(b.importe)},
        meses = ${meses}, estado = ${txt(b.estado, 20)}, updated_at = now()
      WHERE id = ${id}`;
    return json({ ok: true });
  }

  return json({ error: 'method' }, 405);
}
