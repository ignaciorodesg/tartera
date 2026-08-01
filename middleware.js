// Cierra todo /data/* salvo la propia pantalla de acceso.
// Sin esto, cualquier página con datos incrustados sería legible por URL directa.
//
// /bellesguard/* sigue cubierto: es la ruta antigua. Mientras esos ficheros existan
// en el repo hay que protegerlos igual, y una vez borrados el redirect no estorba.
import { verifySession, readCookie } from './api/_lib/auth.js';

export const config = {
  matcher: ['/data/:path*', '/bellesguard/:path*'],
};

const ABIERTAS = new Set(['/data', '/data/', '/data/index.html']);
const LOGIN = '/data/';

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  // La ruta vieja no sirve nada nunca: siempre a la nueva.
  if (pathname === '/bellesguard' || pathname.startsWith('/bellesguard/')) {
    return new Response(null, {
      status: 308,
      headers: { Location: new URL(LOGIN, request.url).toString(), 'Cache-Control': 'no-store' },
    });
  }

  // La pantalla de acceso tiene que ser alcanzable sin sesión.
  if (ABIERTAS.has(pathname)) return;

  if (await verifySession(readCookie(request), process.env)) return;

  // Sin sesión: al login, y que no quede cacheada la redirección.
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(LOGIN, request.url).toString(),
      'Cache-Control': 'no-store',
    },
  });
}
