// GET    /api/adjunto            -> lista ligera (sin los bytes)
// GET    /api/adjunto?id=7       -> el PDF, solo con sesión
// POST   /api/adjunto            -> { seguro_id, nombre, datos (base64) }
// DELETE /api/adjunto?id=7
//
// Los PDF viven en la base y se sirven por aquí, nunca por una URL pública:
// una póliza lleva DNI, dirección y datos bancarios.
import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const MAX_BYTES = 4 * 1024 * 1024; // el cuerpo de una Edge Function no da para más
const PDF_MAGIC = '%PDF-';

// Nombre de fichero seguro para la cabecera Content-Disposition
const nombreSeguro = (s) =>
  String(s || 'poliza.pdf')
    .replace(/[^\w .\-()áéíóúüñÁÉÍÓÚÜÑ]/g, '_')
    .slice(0, 100) || 'poliza.pdf';

function base64aBytes(b64) {
  const limpio = String(b64 || '').replace(/^data:[^;]*;base64,/, '').replace(/\s/g, '');
  const bin = atob(limpio);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;

  const q = new URL(request.url).searchParams;

  if (request.method === 'GET') {
    const id = Number(q.get('id'));

    if (!id) {
      const rows = await sql`
        SELECT id, seguro_id, nombre, tamano, created_at
        FROM bellesguard.adjuntos ORDER BY id`;
      return json({ rows });
    }

    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    const [row] = await sql`SELECT nombre, datos FROM bellesguard.adjuntos WHERE id = ${id}`;
    if (!row) return json({ error: 'no_existe' }, 404);

    const bytes = base64aBytes(row.datos);
    return new Response(bytes, {
      headers: {
        // Tipo forzado: aunque en la base hubiera otra cosa, aquí solo sale PDF.
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nombreSeguro(row.nombre)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; object-src 'none'",
        'Cache-Control': 'no-store, private',
      },
    });
  }

  if (request.method === 'DELETE') {
    const id = Number(q.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ error: 'id_invalido' }, 400);
    await sql`DELETE FROM bellesguard.adjuntos WHERE id = ${id}`;
    return json({ ok: true });
  }

  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const seguroId = Number(b.seguro_id);
  if (!Number.isInteger(seguroId) || seguroId < 1) return json({ error: 'seguro_invalido' }, 400);

  const [existe] = await sql`SELECT id FROM bellesguard.seguros WHERE id = ${seguroId}`;
  if (!existe) return json({ error: 'seguro_no_existe' }, 404);

  let bytes;
  try {
    bytes = base64aBytes(b.datos);
  } catch {
    return json({ error: 'base64_invalido' }, 400);
  }
  if (!bytes.length) return json({ error: 'fichero_vacio' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'demasiado_grande', max_mb: 4 }, 413);

  // Que sea un PDF de verdad, no cualquier cosa renombrada
  const cabecera = new TextDecoder().decode(bytes.slice(0, 5));
  if (cabecera !== PDF_MAGIC) return json({ error: 'no_es_pdf' }, 400);

  const limpio = String(b.datos || '').replace(/^data:[^;]*;base64,/, '').replace(/\s/g, '');
  const [row] = await sql`
    INSERT INTO bellesguard.adjuntos (seguro_id, nombre, tamano, datos)
    VALUES (${seguroId}, ${nombreSeguro(b.nombre)}, ${bytes.length}, ${limpio})
    RETURNING id`;

  return json({ ok: true, id: row.id, tamano: bytes.length });
}
