// Muro de acceso al editor (/keystatic). Este fichero solo lo engancha.
//
// Si tu web YA tiene un src/middleware.ts, no lo sustituyas por este: deja el
// tuyo y encadena el muro el primero, así:
//
//   import { sequence } from 'astro:middleware';
//   import { onRequestMuro } from './lib/cms-middleware';
//   export const onRequest = sequence(onRequestMuro, tuMiddleware);
//
// El muro solo actúa en /keystatic y /api/keystatic; todo lo demás pasa sin tocar.

export { onRequestMuro as onRequest } from './lib/cms-middleware';
