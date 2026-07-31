// Cierra todo /bellesguard/* salvo la propia pantalla de acceso.
// Sin esto, cualquier página con datos incrustados sería legible por URL directa.
import { verifySession, readCookie } from './api/_lib/auth.js';

export const config = {
  matcher: ['/bellesguard/:path*'],
};

const ABIERTAS = new Set(['/bellesguard', '/bellesguard/', '/bellesguard/index.html']);

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  // La pantalla de acceso tiene que ser alcanzable sin sesión.
  if (ABIERTAS.has(pathname)) return;

  if (await verifySession(readCookie(request), process.env)) return;

  // Sin sesión: al login, y que no quede cacheada la redirección.
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL('/bellesguard/', request.url).toString(),
      'Cache-Control': 'no-store',
    },
  });
}
