# Esta web

Web Astro con editor de contenido (Keystatic) y el acceso de su cliente («muro»
de Repeat Clientes). Sale de la plantilla técnica de Repeat: el diseño es de
esta web, no de la plantilla.

## Cómo está hecha

- El contenido editable vive en `src/content/` y su esquema en
  `keystatic.config.ts`. Los textos no se escriben dentro de los `.astro`:
  así el cliente los puede cambiar desde `/keystatic`.
- `keystatic.config.ts` apunta a este repositorio (`owner`/`name` de
  `storage`). Si apunta a otro, el editor no puede guardar.
- El muro protege `/keystatic`: `src/middleware.ts`, `src/lib/cms-*.ts`,
  `src/lib/aviso-publicacion.ts`, `src/pages/acceso.astro` y
  `src/pages/api/cms-*.ts`. No se tocan a mano: se actualizan con la versión
  que da la herramienta `muro_actual` del conector de Clientes
  (`muro-version.txt` dice cuál lleva).
- En Vercel hacen falta `CMS_SITE_ID` y `CMS_SITE_KEY`. Las pone la orden que
  devuelve `alta_web`; la clave nunca se escribe en el chat ni en el código.

## Antes de cambiar nada

El cliente guarda desde su editor haciendo commits en `main`. Antes de tocar
nada, trae lo suyo: `git pull`. Si no, al subir pisarías sus cambios.

## Publicar

Un push a `main` publica (Vercel despliega solo). Comprueba la web después con
`comprobar_web` del conector.
