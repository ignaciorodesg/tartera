import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL: conecta Neon al proyecto en Vercel.');
}

// sql`SELECT ...` interpola SIEMPRE como parámetros: no hay inyección posible.
export const sql = neon(process.env.DATABASE_URL);

// Contador de revocación de sesiones. Al subirlo, todas las cookies emitidas dejan de valer.
export async function sessionEpoch() {
  try {
    const [r] = await sql`SELECT value FROM bellesguard.meta WHERE key = 'session_epoch'`;
    return Number(r?.value) || 0;
  } catch {
    return 0;
  }
}

export async function subirSessionEpoch() {
  const nuevo = (await sessionEpoch()) + 1;
  await sql`
    INSERT INTO bellesguard.meta (key, value) VALUES ('session_epoch', ${String(nuevo)})
    ON CONFLICT (key) DO UPDATE SET value = ${String(nuevo)}`;
  return nuevo;
}
