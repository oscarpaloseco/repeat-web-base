// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import vercel from '@astrojs/vercel';

// Las páginas son estáticas; solo el editor (/keystatic) y el muro de acceso
// se resuelven en el servidor. No actives edgeMiddleware: el muro corre en Node.
export default defineConfig({
  // site: 'https://tu-web.com',
  output: 'static',
  adapter: vercel(),
  integrations: [react(), keystatic()],
});
