// GET    /api/bancos        -> lista
// POST   /api/bancos        -> alta
// PUT    /api/bancos        -> edición { id, ... }
// DELETE /api/bancos?id=1   -> baja
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);

// El logo se pinta con <img src>: solo admitimos https, nada de javascript: ni data:
const url = (v) => {
  const s = txt(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
};

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  const q = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    const rows = await sql`
      SELECT id, codigo, nombre, cuenta, sucursal, responsable, telefono, email, logo, notas, orden
      FROM bellesguard.bancos ORDER BY orden, nombre`;
    return json({ rows });
  }

  if (request.method === 'DELETE') {
    const id = Number(q.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`DELETE FROM bellesguard.bancos WHERE id = ${id}`;
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

  const campos = {
    codigo: txt(b.codigo, 10).toUpperCase(),
    nombre,
    cuenta: txt(b.cuenta, 30),
    sucursal: txt(b.sucursal, 120),
    responsable: txt(b.responsable, 80),
    telefono: txt(b.telefono, 30),
    email: txt(b.email, 120),
    logo: url(b.logo),
    notas: txt(b.notas, 400),
    orden: Number.isInteger(b.orden) ? b.orden : 0,
  };

  if (request.method === 'POST') {
    const [row] = await sql`
      INSERT INTO bellesguard.bancos (codigo, nombre, cuenta, sucursal, responsable, telefono, email, logo, notas, orden)
      VALUES (${campos.codigo}, ${campos.nombre}, ${campos.cuenta}, ${campos.sucursal},
              ${campos.responsable}, ${campos.telefono}, ${campos.email}, ${campos.logo},
              ${campos.notas}, ${campos.orden})
      RETURNING id`;
    return json({ ok: true, id: row.id });
  }

  if (request.method === 'PUT') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`
      UPDATE bellesguard.bancos SET
        codigo = ${campos.codigo}, nombre = ${campos.nombre}, cuenta = ${campos.cuenta},
        sucursal = ${campos.sucursal}, responsable = ${campos.responsable},
        telefono = ${campos.telefono}, email = ${campos.email}, logo = ${campos.logo},
        notas = ${campos.notas}, orden = ${campos.orden}, updated_at = now()
      WHERE id = ${id}`;
    return json({ ok: true });
  }

  return json({ error: 'method' }, 405);
}
