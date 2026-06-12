# CLAUDE.md — envis

Dashboard **web** (ejecutable con `npx`) para gestionar ficheros `.env`: activar/desactivar
variables, CRUD, perfiles y comparar. Multi-proyecto. TypeScript + ESM en todo el stack.

## Comandos

- `npm run dev` — desarrollo: Vite (`:5173`) + API (`:5179`). Vite proxya `/api` al backend.
- `npm run build` — `tsup` (→ `dist/cli.js`) + `vite build` (→ `dist/web/index.html`, todo inline).
- `npm start` — ejecuta el CLI ya construido (`node dist/cli.js`): arranca el daemon y abre el navegador.
- `npm test` — tests con Vitest. **Usa `npm test`, NO `npx vitest`** (npx falla en este entorno).
- `npm run typecheck` — `tsc` para Node (`tsconfig.json`) y web (`tsconfig.web.json`).

## Arquitectura

Tres capas:

- **`src/core/`** — lógica pura, sin I/O. `env-file.ts`: parser/serializador `.env` *no destructivo*
  (el corazón), `diffWithExample`, `compareEnvFiles`.
- **`src/server/`** — API Hono. `app.ts` (rutas, `createApp({ currentDir })`), `project.ts` (I/O de
  ficheros .env), `registry.ts` (proyectos en `~/.config/envis`), `browse.ts` (explorador de carpetas),
  `daemon.ts` (gestión del daemon en background: estado, health-check, arranque detached).
- **`src/web/`** — frontend React (Vite). `App.tsx` (dashboard + modales), `api.ts` (cliente fetch tipado).
- **`src/cli.ts`** — entrada `npx`: router de subcomandos (cliente por defecto, `--daemon`, `--isolated`,
  `stop`, `status`). Monta Hono (API + el `index.html` único) y, de cliente, asegura el daemon y abre el navegador.
- **`src/server/dev.ts`** — backend para desarrollo (puerto fijo `5179`).

**Distribución**: el frontend se empaqueta en UN `dist/web/index.html` (`vite-plugin-singlefile`,
JS+CSS inline); el CLI lo lee y lo sirve para toda ruta no-`/api`. Se publica solo `dist/`.

## Decisiones clave

- **Parser no destructivo**: NO usar `dotenv` (descarta comentarios, orden y formato). `env-file.ts`
  modela el fichero línea a línea; las líneas no tocadas se reescriben tal cual. Las variables se
  identifican por **número de línea**, no por clave (una clave puede estar activa y comentada a la vez).
  El toggle manipula el prefijo `#` preservando el resto de la línea.
- **API por proyecto**: las rutas de ficheros son `/api/projects/:id/files/...`; el directorio se
  resuelve por `:id` desde el registro. El cwd se auto-registra al arrancar el CLI (`cli.ts`) y, como
  respaldo, vía `GET /api/current`.
- **Modo daemon (por defecto)**: `envis` arranca UN server persistente en background (detached) que
  sirve todo el registro; el terminal queda libre. El cliente lo detecta por health-check a `/api/meta`
  y lo levanta si no responde. Estado (`{pid,port}`) en `~/.config/envis/daemon.json`, logs en
  `daemon.log`; puerto fijo `ENVIS_PORT` (def. `5180`). Cada `envis <dir>` registra el cwd y abre el
  navegador en `?project=<id>`, que el frontend prioriza sobre `/api/current`. El daemon corre sin
  `currentDir` (neutral); `envis stop` / `status` lo controlan.
- **Modo aislado (`--isolated`)**: el cwd es el ÚNICO proyecto y vive en memoria (`makeProject` con id
  fijo `"isolated"`); NO se lee ni escribe el registro. `createApp({ isolated })` filtra `/api/projects`
  y `requireProjectDir`, y `POST/DELETE /api/projects` responden 403. El frontend lee `GET /api/meta`
  (`{ isolated }`) para ocultar añadir/quitar proyecto.
- **Registro de proyectos**: `~/.config/envis/projects.json` (override con `ENVIS_CONFIG_DIR`).
- **Seguridad**: nombres de fichero validados (`.env*`, sin path traversal); el server escucha en
  `127.0.0.1`.

## Convenciones de código

- ESM, imports **sin extensión** (resolución `Bundler`; el bundling lo hacen tsup/Vite).
- `verbatimModuleSyntax`: importar tipos con `import type`.
- Tests junto al código (`*.test.ts`). Hay un `vitest.config.ts` propio para **no heredar**
  `root: "src/web"` de `vite.config.ts` (si no, Vitest no encuentra los tests).
- Operaciones de fichero: leer → mutar `EnvFile` → escribir (`readEnvFile`/`writeEnvFile`).

## Variables de entorno (del propio CLI)

- `ENVIS_NO_OPEN=1` — no abrir el navegador al arrancar (útil en tests/headless).
- `ENVIS_CONFIG_DIR` — dónde guardar el registro de proyectos y el estado del daemon (aislamiento en tests).
- `ENVIS_PORT` — puerto del daemon (por defecto `5180`).
