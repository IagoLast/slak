# Slak

Chat de empresa sencillo, estilo Slack, pensado para desplegarse en Vercel.

## Qué incluye

- **Canales** públicos y privados, y **mensajes directos** entre personas.
- **Usuarios externos (invitados)**: solo ven los canales a los que se les da acceso.
- **Archivos e imágenes** adjuntos en los mensajes (Vercel Blob, máx. 4 MB).
- **Notas de voz** grabadas desde el navegador.
- **Notificaciones**: contadores de no-leídos y notificaciones del navegador.
- Registro **solo por invitación** (el primer usuario que se registra es el admin).

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- Postgres ([Neon](https://neon.tech) / Vercel Postgres) con [Drizzle ORM](https://orm.drizzle.team)
- [Auth.js](https://authjs.dev) (email + contraseña, sesiones JWT)
- [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) para archivos y audios
- Mensajería casi en tiempo real por polling (SWR) — sin websockets ni servicios extra

## Desplegar en Vercel

1. Importa este repositorio en [vercel.com/new](https://vercel.com/new).
2. En el proyecto, ve a **Storage** y crea:
   - Una base de datos **Postgres** (Neon). Esto añade `DATABASE_URL` automáticamente.
   - Un store de **Blob**. Esto añade `BLOB_READ_WRITE_TOKEN` automáticamente.
3. Añade la variable de entorno `AUTH_SECRET` (genera una con `openssl rand -base64 32`).
4. Despliega.
5. Crea las tablas visitando **`https://tu-app.vercel.app/api/setup`** (es
   idempotente; también puedes usar `npm run db:push` en local si lo prefieres).
6. Abre la app, entra en **/register** y crea tu cuenta: el primer usuario es
   administrador y se crea el canal `#general` automáticamente.
7. Desde **Invitar personas**, bajo el nombre del workspace en la barra lateral,
   genera enlaces para el resto del equipo o para invitados externos. Esta opción
   requiere el rol de administrador. Indica un email si quieres restringir quién
   puede usar el enlace y elige los canales iniciales (`#general` viene seleccionado).
   Copia y comparte el enlace: no se envía email automáticamente. Cada enlace permite
   crear una sola cuenta; puedes revocarlo mientras siga pendiente.

## Desarrollo local

```bash
cp .env.example .env.local   # rellena DATABASE_URL, AUTH_SECRET y BLOB_READ_WRITE_TOKEN
npm install
npm run db:push              # crea las tablas (lee .env / .env.local)
npm run dev
```

> Nota: drizzle-kit lee `.env`; si usas `.env.local`, duplica ahí `DATABASE_URL`
> o exporta la variable antes de ejecutar `npm run db:push`.

## Roles

| Rol               | Permisos                                                           |
| ----------------- | ------------------------------------------------------------------ |
| `admin`           | Todo: crear canales, invitar miembros e invitados externos         |
| `member`          | Ver todos los canales públicos, crear canales, DMs, subir archivos |
| `guest` (externo) | Solo los canales a los que ha sido añadido, y DMs                  |

## Límites conocidos (a propósito, para mantenerlo simple)

- Los mensajes se actualizan por polling cada ~2,5 s; no hay websockets.
- Archivos hasta 4 MB (límite del cuerpo de las funciones de Vercel).
- Las notificaciones son del navegador (no push móvil) y solo con la app abierta.

## Probar en local con Docker

```bash
npm install
npm run dev:local
```

Esto levanta un Postgres local independiente (puerto 54329) y Next.js en
`http://localhost:3000`. Abre `/register` para crear el primer administrador.
Puedes cambiar el puerto con `PORT=3107 npm run dev:local`. Los datos se conservan
en el volumen `slak_data`; `docker compose stop` detiene la base sin borrarlos.
El secreto de sesión de desarrollo cambia al reiniciar si no defines `AUTH_SECRET`.
Los adjuntos siguen necesitando `BLOB_READ_WRITE_TOKEN`; chat y sesiones de Orca no.

## Orca remoto

La v0 combina canales y mensajes directos entre personas con las sesiones de Orca
de las máquinas compartidas. No hay bots de proyecto, encargos ni delegación.

1. En **Máquinas compartidas → Conectar mi Orca**, copia el comando y ejecútalo
   en la máquina que tiene Orca. Elige los proyectos que quieres compartir.
2. La barra lateral muestra **máquina → proyecto → worktree**.
3. Haz clic en un worktree para abrir sus **pestañas de sesiones**. Cada pestaña
   mantiene su propia conversación, historial, actividad, preguntas y aprobaciones.
   Las sesiones nativas existentes se reutilizan sin cambiar sus instrucciones.
4. Escribe directamente a la sesión. **Interrumpir** cancela el turno y los mensajes
   pendientes de esa sesión; conserva el runtime y puedes seguir hablando después.
5. Si la máquina se desconecta, puedes consultar el historial sincronizado. Los
   mensajes nuevos quedan en cola hasta que vuelva a conectarse.

Si no hay sesiones disponibles, **Abrir conversación** prepara una nueva; Orca
la inicia al enviar el primer mensaje. Abrir un worktree no arranca agentes padre
ni crea worktrees adicionales. Las conversaciones importadas son privadas para
quien las abre y el propietario de la máquina; las existentes conservan sus permisos.
Los invitados solo acceden a conversaciones que ya tienen compartidas.

El menú de sesión permite compactar contexto o detener la sesión. El propietario
(o un administrador) puede cerrar y archivar un worktree, con confirmación,
conservando archivos e historial. Interrumpir requiere un puente actualizado:
**actualiza y reinicia el puente en cada máquina** para habilitarlo.

### Conexión

Requiere macOS/Linux, Node 20+ con npm, `curl`, Orca abierto con su CLI instalado
y Codex o Claude Code autenticados. Mantén la terminal del puente abierta;
`Ctrl+C` lo detiene. El instalador guarda un acceso para reconectar en
`~/.slak/machines/<id>/conectar.command`. El comando de alta es personal, de un
solo uso y caduca a los 15 minutos. Para otra máquina usa una URL HTTPS de Slak
accesible desde ella. El puente no abre puertos.

Las configuraciones manuales siguen funcionando:

```bash
npm run orca:bridge -- --config ./slak-machine.json --repo id:ID_DEL_PROYECTO
```

Puedes repetir `--repo`, usar `--share-all` o limitar los worktrees con
`--worktree path:/ruta`. El instalador guarda la selección de proyectos.

### Transporte e historial

- El adaptador nativo usa `agentSession.create/send/history/cancel` del runtime
  de Orca y comprueba `agent-session.structured.v1`. Si no encuentra la instalación,
  define `SLAK_ORCA_RUNTIME=/ruta/a/out/cli/runtime/client.js`.
- Los envíos tienen recibos persistentes para no duplicar mensajes tras reconectar.
  Los eventos se sincronizan por item, revisión y cursor.
- Las sesiones de terminal sincronizan también los mensajes anteriores de Codex y
  Claude desde el transcript que Orca identifica para ese terminal. Solo se publican
  mensajes de usuario y asistente; los controles de turno siguen en Orca.
  Actualiza y reinicia el puente para incorporar este historial.
- La base conserva los identificadores y registros anteriores por compatibilidad.
  Los canales internos de las sesiones no aparecen como canales de Slack.
- El endpoint `/api/mcp` mantiene el transporte autenticado del puente. Las
  credenciales por conversación solo exponen contexto, historial y memoria;
  ya no hay herramientas de delegación ni creación de worktrees.

## UI y canales

La interfaz usa shadcn/Radix para botones, formularios, diálogos, selectores,
menús, estados y navegación móvil. Clic derecho en un canal (o su menú `…`)
permite borrarlo con confirmación. Solo su creador o un administrador pueden
borrarlo; la API comprueba el permiso y elimina mensajes, hilos y tareas en cascada.
Los mensajes directos no admiten este borrado.

## Comprobaciones

```bash
npm run lint
npx tsc --noEmit
npm test                 # contratos de los adaptadores, sin lanzar agentes reales
node --import tsx --test tests/workspaces.test.ts tests/work-view.test.ts
npm run build
```

Pruebas de concurrencia y aislamiento MCP contra una base de pruebas independiente:

```bash
SLAK_TEST_DATABASE=1 DATABASE_URL=postgres://.../slak_work_checks npx tsx --test tests/work.test.ts tests/worktree-chat.test.ts
SLAK_TEST_DATABASE=1 DATABASE_URL=postgres://...@127.0.0.1:54329/slak npx tsx --test tests/machine-pairing.test.ts
```

Regresión del registro durante una migración pendiente (Postgres local con permiso
para crear bases; crea y elimina su propia base temporal):

```bash
SLAK_TEST_DATABASE=1 DATABASE_URL=postgres://...@127.0.0.1:54329/slak npx tsx --test tests/registration.test.ts
```

Las pruebas de base de datos crean y eliminan sus propios fixtures. Los tests del
puente usan un runtime simulado y no envían mensajes a sesiones reales de Orca.
