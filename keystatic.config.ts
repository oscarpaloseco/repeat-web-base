import { config, fields, singleton } from '@keystatic/core';

// En local escribe ficheros; en producción guarda con un commit en el
// repositorio. PROPIETARIO/REPOSITORIO se cambian por el repositorio real de
// esta web nada más crearla (si apuntan a otro, el editor no puede guardar).
export default config({
  storage: import.meta.env.DEV
    ? { kind: 'local' }
    : { kind: 'github', repo: { owner: 'PROPIETARIO', name: 'REPOSITORIO' } },
  ui: { brand: { name: 'Mi web' } },
  singletons: {
    // Ejemplo mínimo de contenido editable: cámbialo por el de la web.
    inicio: singleton({
      label: 'Inicio',
      path: 'src/content/inicio',
      format: { data: 'json' },
      schema: {
        titulo: fields.text({ label: 'Título' }),
        texto: fields.text({ label: 'Texto', multiline: true }),
      },
    }),
  },
});
