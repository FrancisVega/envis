# envis

Pequeño dashboard **web** para gestionar tus ficheros `.env`. Lo arrancas con `npx`, se abre en el
navegador y administras las variables de entorno con un par de clics — sin editar el fichero a mano.

```bash
npx @hiscovega/envis
```

Levanta un servidor local en `127.0.0.1`, abre el navegador y opera sobre los `.env` del directorio
donde lo ejecutes.

## Qué hace

- **Activar / desactivar** variables con un interruptor (comenta/descomenta con `#` conservando el valor).
- **Editar, añadir y borrar** variables.
- **Perfiles**: alterna entre `.env`, `.env.development`, `.env.production`…
  - **Volcar** un perfil a `.env` (guarda antes una copia en `.env.bak`).
  - **Crear / duplicar** perfiles.
  - **Comparar** dos perfiles: qué claves cambian de valor, cuáles están solo en uno u otro.
- **Comparar con `.env.example`**: detecta qué claves faltan o sobran.
- **Multi-proyecto**: añade varias carpetas (con explorador integrado) y cambia entre ellas desde un
  sidebar. El listado se guarda en `~/.config/envis`.

La edición es **no destructiva**: se conservan comentarios, orden y formato del fichero.

## Uso

En un proyecto que tenga un `.env`:

```bash
cd mi-proyecto
npx @hiscovega/envis
```

Al ejecutarlo, el directorio actual se registra automáticamente como proyecto (si no lo estaba ya).

Opciones:

- `--isolated` — trabaja **solo** con el directorio actual, sin leer ni escribir el registro global
  de proyectos. Útil para abrir un `.env` puntual sin que aparezca el resto de proyectos ni quede
  recordado.

Variables de entorno:

- `ENVIS_NO_OPEN=1` — no abrir el navegador automáticamente (solo imprime la URL).

## Desarrollo

```bash
npm install
npm run dev        # Vite (:5173) + API (:5179)
npm test
npm run build
```

## Licencia

[MIT](./LICENSE)
