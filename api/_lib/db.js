import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL: conecta Neon al proyecto en Vercel.');
}

// sql`SELECT ...` interpola SIEMPRE como parámetros: no hay inyección posible.
export const sql = neon(process.env.DATABASE_URL);
