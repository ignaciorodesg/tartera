// Etapas y momentos de la vida, para pintar la rejilla del Memento Mori.
// Si `hasta` viene vacío es un momento suelto: una sola semana marcada.
//
// GET    /api/etapas        -> lista ordenada por fecha
// POST   /api/etapas        -> alta { nombre, desde, hasta, color, nota }
// PUT    /api/etapas        -> edición { id, ... }
// DELETE /api/etapas?id=1
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const fecha = (v) => {
  const s = txt(v, 10);
  return FECHA_RE.test(s) ? s : null;
};

async function asegurarTabla() {
  await sql`
    CREATE TABLE IF NOT EXISTS bellesguard.etapas (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      desde DATE NOT NULL,
      hasta DATE,
      color TEXT NOT NULL DEFAULT '#0F6E56',
      nota TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
}

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  await asegurarTabla();
  const q = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    const rows = await sql`
      SELECT id, nombre, desde::text, hasta::text, color, nota
      FROM bellesguard.etapas ORDER BY desde, id`;
    return json({ rows });
  }

  if (request.method === 'DELETE') {
    const id = Number(q.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`DELETE FROM bellesguard.etapas WHERE id = ${id}`;
    return json({ ok: true });
  }

  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const nombre = txt(b.nombre, 80);
  if (!nombre) return json({ error: 'nombre_vacio' }, 400);

  const desde = fecha(b.desde);
  if (!desde) return json({ error: 'desde_invalido' }, 400);

  let hasta = fecha(b.hasta);
  if (hasta && hasta < desde) return json({ error: 'hasta_antes_de_desde' }, 400);

  const color = COLOR_RE.test(txt(b.color, 7)) ? txt(b.color, 7) : '#0F6E56';
  const nota = txt(b.nota, 500);

  if (request.method === 'POST') {
    const [row] = await sql`
      INSERT INTO bellesguard.etapas (nombre, desde, hasta, color, nota)
      VALUES (${nombre}, ${desde}, ${hasta}, ${color}, ${nota})
      RETURNING id`;
    return json({ ok: true, id: row.id });
  }

  if (request.method === 'PUT') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`
      UPDATE bellesguard.etapas
      SET nombre = ${nombre}, desde = ${desde}, hasta = ${hasta},
          color = ${color}, nota = ${nota}, updated_at = now()
      WHERE id = ${id}`;
    return json({ ok: true });
  }

  return json({ error: 'method' }, 405);
}
