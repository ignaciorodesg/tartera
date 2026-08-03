// Activos asegurados: la casa, el coche, la vida... Cada uno es una caja en la página de Seguros.
// Las pólizas de bellesguard.seguros se enganchan por nombre (seguros.asegurado = asegurados.nombre),
// así que al renombrar un activo hay que arrastrar sus pólizas: se hace en el PUT.
//
// GET    /api/asegurados        -> lista
// POST   /api/asegurados        -> alta { nombre, tipo, notas }
// PUT    /api/asegurados        -> edición { id, nombre, tipo, notas, orden }
// DELETE /api/asegurados?id=1   -> baja (las pólizas no se borran, se quedan sin activo)
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const txt = (v, max = 120) => String(v ?? '').trim().slice(0, max);

// La tabla se crea sola la primera vez y se siembra con los nombres que ya hubiera en las pólizas.
async function asegurarTabla() {
  await sql`
    CREATE TABLE IF NOT EXISTS bellesguard.asegurados (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      orden SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;

  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM bellesguard.asegurados`;
  if (n > 0) return;

  await sql`
    INSERT INTO bellesguard.asegurados (nombre)
    SELECT DISTINCT btrim(asegurado) FROM bellesguard.seguros
    WHERE btrim(COALESCE(asegurado, '')) <> ''
    ON CONFLICT (nombre) DO NOTHING`;
}

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  await asegurarTabla();
  const q = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    // Cada activo con su póliza más reciente: es la que decide si está cubierto o caducado.
    const rows = await sql`
      SELECT a.id, a.nombre, a.tipo, a.notas, a.orden,
             s.id AS poliza_id, s.fecha::text AS poliza_fecha, s.concepto AS poliza_concepto,
             s.importe AS poliza_importe, s.banco AS poliza_banco, s.meses AS poliza_meses,
             s.estado AS poliza_estado
      FROM bellesguard.asegurados a
      LEFT JOIN LATERAL (
        SELECT * FROM bellesguard.seguros s2
        WHERE btrim(s2.asegurado) = a.nombre
        ORDER BY s2.fecha DESC NULLS LAST, s2.id DESC LIMIT 1
      ) s ON true
      ORDER BY a.orden, a.nombre`;
    return json({ rows });
  }

  if (request.method === 'DELETE') {
    const id = Number(q.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`DELETE FROM bellesguard.asegurados WHERE id = ${id}`;
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
  const tipo = txt(b.tipo, 40);
  const notas = txt(b.notas, 400);
  const orden = Number.isInteger(b.orden) ? b.orden : 0;

  if (request.method === 'POST') {
    const [row] = await sql`
      INSERT INTO bellesguard.asegurados (nombre, tipo, notas, orden)
      VALUES (${nombre}, ${tipo}, ${notas}, ${orden})
      ON CONFLICT (nombre) DO UPDATE SET tipo = EXCLUDED.tipo, notas = EXCLUDED.notas, updated_at = now()
      RETURNING id`;
    return json({ ok: true, id: row.id });
  }

  if (request.method === 'PUT') {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);

    const [antes] = await sql`SELECT nombre FROM bellesguard.asegurados WHERE id = ${id}`;
    if (!antes) return json({ error: 'no_existe' }, 404);

    await sql`
      UPDATE bellesguard.asegurados
      SET nombre = ${nombre}, tipo = ${tipo}, notas = ${notas}, orden = ${orden}, updated_at = now()
      WHERE id = ${id}`;

    // El vínculo con las pólizas es el nombre: si cambia, hay que arrastrarlas.
    let polizas = 0;
    if (antes.nombre !== nombre) {
      const r = await sql`
        UPDATE bellesguard.seguros SET asegurado = ${nombre}, updated_at = now()
        WHERE btrim(asegurado) = ${antes.nombre}`;
      polizas = r.length ?? 0;
    }
    return json({ ok: true, polizas_reasignadas: polizas });
  }

  return json({ error: 'method' }, 405);
}
