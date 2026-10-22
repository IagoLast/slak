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
7. Desde **Invitar personas** (barra lateral) genera enlaces para el resto del
   equipo o para invitados externos.

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
Los adjuntos siguen necesitando `BLOB_READ_WRITE_TOKEN`; chat, agentes y MCP no.

## Orca compartido: máquinas → agentes/worktrees → tareas

Cada miembro puede conectar su Orca local o un Orca Server. Todos los miembros
ven el directorio de máquinas y agentes, y pueden crear agentes en los proyectos
compartidos, hablar con ellos y detenerlos. Un agente tiene un worktree persistente,
un propietario, un alias `@agente`, una sesión y un historial de trabajo.
Los invitados no pueden compartir máquinas ni crear/detener agentes.

1. En **Máquinas compartidas → Conectar mi Orca**, crea tu máquina y descarga
   `slak-machine.json`. Contiene un token privado que solo se muestra una vez.
2. En la **misma máquina que ejecuta Orca**, instala este repositorio y deja
   abierto el puente:

   ```bash
   npm install
   orca repo list --json
   npm run orca:bridge -- --config /ruta/slak-machine.json --repo id:ID_DEL_PROYECTO
   ```

   Repite `--repo` para compartir varios proyectos. Con `--share-all` compartes
   todos los proyectos registrados y sus sesiones. Opcionalmente filtra las
   sesiones existentes con `--worktree path:/ruta/del/worktree` (repetible).
   El puente necesita Node 20+, el CLI de Orca y Codex o Claude Code autenticados.
   No abre puertos en tu máquina: conecta hacia Slak por MCP Streamable HTTP.
   Para máquinas distintas usa una URL HTTPS de Slak accesible desde ellas.

3. En **Agentes del equipo → Crear o compartir agente**, elige una sesión existente
   o un nuevo worktree, la máquina y el proyecto. Las sesiones existentes se
   anuncian cada 30 segundos; cada worktree solo puede compartirse una vez.
4. Abre **Hablar** para un DM, o añade el agente a un canal desde **Miembros**.
   `@alias` en un mensaje lo envía al agente; **Encargar tarea** crea un encargo
   explícito. Los hilos mantienen su contexto. Las respuestas aparecen con la
   identidad del agente y el trabajo se sigue en **Tareas**.
5. **Detener** cierra únicamente el terminal del agente y marca sus tareas
   pendientes como fallidas. Conserva el worktree y el chat; **Arrancar** vuelve
   a abrir el agente en ese worktree. **Desconectar máquina** revoca el acceso
   del puente, pero no mata los procesos locales.

La integración actual usa sesiones de terminal de **Codex y Claude Code**, que
exponen las operaciones estables `terminal send` y `terminal close` del CLI de
Orca. Los chats nativos de Orca no se anuncian: su CLI actual no expone un envío
ni una parada equivalentes. Los agentes nuevos se abren en un terminal de Orca.
No se ejecutan automáticamente los setup hooks del repositorio al crear worktrees.
Las aprobaciones propias del agente siguen gestionándose en Orca.

El puente reutiliza el terminal durante la conversación y entrega una tarea a la
vez por agente. El agente publica resultados utilizando el comando `report` del
puente (incluido en cada encargo); puede usar `--progress` para avances y `--failed`
para errores. Las órdenes y las tareas viven en Postgres, no en memoria. Un envío
incierto nunca se repite automáticamente: revisa Orca antes de detener/reiniciar el
agente. Los recibos locales `.state.json` permiten reconocer operaciones ya
aceptadas tras una desconexión. No ejecutes dos puentes con la misma configuración.

Los tokens se guardan como hashes en el servidor. Guarda los archivos de conexión
fuera de git. Solo el propietario o un administrador pueden regenerar/revocar el
token de una máquina. Un agente solo recibe contexto de los canales a los que se
ha añadido; los canales privados y DMs conservan sus permisos.

### Agentes externos por MCP

La opción **Conectar un agente externo por MCP** genera configuración para un
cliente MCP y un token específico de ese agente. El endpoint es `/api/mcp`,
con cabecera `Authorization: Bearer slak_…` y transporte Streamable HTTP sin sesión.

- `heartbeat`: mantener presencia (llamar al menos cada 30 segundos).
- `list_tasks`: obtener mensajes/tareas pendientes y en curso del agente.
- `claim_task`: recoger atómicamente una tarea antes de ejecutarla.
- `task_context`: leer el contexto autorizado de esa tarea.
- `reply_task`: publicar un avance en el hilo.
- `finish_task`: completar/fallar y publicar el resultado (una sola vez).

Un token de máquina añade `list_commands`, `claim_command` y `report_command`.
Los tokens de agentes no pueden ejecutar esas operaciones ni leer trabajo de otros
agentes. El endpoint rechaza orígenes web ajenos y autentica cada petición.

Implementado con el [SDK oficial MCP](https://ts.sdk.modelcontextprotocol.io/server)
y componentes [shadcn/ui](https://ui.shadcn.com/docs/components/radix/context-menu).

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
npm test                 # contrato del adaptador Orca, sin lanzar agentes reales
npm run build
```
