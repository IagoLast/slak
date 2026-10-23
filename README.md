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

## Orca compartido: máquinas, bots y conversaciones

Cada persona comparte su máquina mediante un puente MCP. El bot (`@iago-bot`) es
una identidad estable, no un proceso ni un worktree. Cada mención principal abre
un **hilo de trabajo** con un orquestador y contexto propios. Responder dentro de
ese hilo continúa el trabajo; no crea otro workspace por mensaje.

1. En **Máquinas compartidas → Conectar mi Orca**, descarga `slak-machine.json`.
2. Ejecuta en la **misma máquina que Orca**:

   ```bash
   npm install
   orca repo list --json
   npm run orca:bridge -- --config ./slak-machine.json --repo id:ID_DEL_PROYECTO
   ```

   Puedes repetir `--repo` o usar `--share-all`. `--worktree path:/ruta` limita el
   acceso a worktrees concretos e impide crear otros. Requiere Node 20+, Orca y
   Codex o Claude Code autenticados. El puente conecta hacia Slak; no abre puertos.
   Para conectar otra máquina, usa una URL HTTPS de Slak accesible desde ella.

3. En **Agentes del equipo**, crea un **bot orquestador** y elige máquina y
   proyecto. Un agente de terminal existente tiene **Activar orquestador** para
   conservar su alias; exige terminar antes su trabajo pendiente. Su terminal
   anterior y sus conversaciones se conservan.
4. Añade el bot al canal desde **Miembros** y menciona `@alias`, abre un DM o usa
   **Encargar tarea**. **Abrir conversación** muestra mensajes, herramientas,
   resultados, cambios y solicitudes de aprobación reales de Orca.
5. El orquestador puede responder directamente, crear un worktree aislado cuando
   necesite editar o delegar en subagentes. Cada subagente tiene conversación propia
   dentro del hilo. El selector del compositor permite hablarle directamente;
   el orquestador recibe automáticamente el encargo y el resultado de esa intervención.
   Los mensajes de varias personas se encolan por sesión; los hilos pueden avanzar
   en paralelo. **Crear subagente** también permite delegar desde la UI.
6. En el menú de conversación puedes **Detener**, **Compactar contexto** o
   **Renovar sesión desde la memoria**. Reanudar una sesión detenida crea una nueva
   generación conservando hilo, memoria y eventos. Detener el bot detiene sus
   sesiones compartidas; el worktree no se borra. Desconectar la máquina revoca el
   puente y deja los procesos locales tal como están.

### Contexto y recuperación

- No existe una sesión global que acumule todas las conversaciones del bot.
- Cada coordinador y cada worker tiene memoria versionada en Postgres, además del
  historial completo y una cola persistente. El agente guarda decisiones, plan,
  restricciones, progreso y referencias con `work_remember`. La UI muestra la
  memoria y los tokens comunicados por el proveedor.
- Antes de enviar otro turno, el puente solicita compactación nativa si Orca
  informa de un uso de contexto de al menos el 80 %. Las sesiones renovadas se
  reconstruyen con objetivo, memoria y turnos recientes; el historial antiguo se
  consulta por páginas con `work_history`. No se inventan porcentajes cuando el
  proveedor no publica consumo.
- Los eventos se sincronizan por item/revisión y cursor. Los envíos guardan su
  identificador, fingerprint y fence antes de ejecutarse. Un reintento conserva
  exactamente la misma operación nativa. Si se pierde el recibo local de un turno
  en curso, se muestra un error y no se duplica el mensaje automáticamente.
- El bridge entrega a cada sesión una credencial MCP limitada a su conversación,
  guardada en `slak-machine.json.sessions/` con permisos privados. El token de la
  máquina no se incluye en el prompt. Las credenciales y recibos están ignorados
  por git. No ejecutes dos puentes con la misma configuración.

### Adaptador nativo y compatibilidad

Las conversaciones nuevas usan `agentSession.create/send/history/cancel` y
`conversationCommand` del runtime de Orca. El adaptador carga el transporte de la
instalación local y comprueba `agent-session.structured.v1`. Se ha comprobado con
**Orca 1.4.229**. Esta API pertenece al runtime y puede cambiar entre versiones;
una instalación incompatible muestra un error, sin simular herramientas ni pasar
silenciosamente a terminal. Si no se detecta la instalación, define
`SLAK_ORCA_RUNTIME=/ruta/a/out/cli/runtime/client.js`.

Los subagentes creados con `work_delegate` son sesiones nativas controlables desde
Slak. La actividad de subagentes internos del proveedor se muestra en su padre;
no se presenta como una conversación independiente si Orca no la expone como tal.
Las preguntas agrupadas y aprobaciones se responden con revisión para impedir
respuestas sobre una solicitud que ya cambió.

Las sesiones de terminal existentes siguen usando el adaptador anterior y sus
resultados `report`; no adquieren retrospectivamente eventos estructurados. El
catálogo automático de sesiones existentes sigue siendo de terminales Codex/Claude;
las conversaciones nativas que Slak crea se gestionan desde **Hilos de trabajo**.
No se ejecutan automáticamente los setup hooks al crear un worktree.

Los canales privados y DMs mantienen sus permisos en listados, historial y MCP.
Quitar al bot de un canal revoca el acceso del puente a los hilos de ese canal.
Solo el propietario o un administrador pueden regenerar/revocar la conexión de
una máquina. Los invitados no pueden conectar máquinas ni detener sesiones.

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

Un token de máquina añade `list_commands`, `claim_command`, `report_command` y
las operaciones de transporte `work_inbox`, `work_claim`, `work_bind`, `work_sync`,
`work_finish` y `work_action`. Las credenciales de conversación solo exponen
`work_context`, `work_history`, `work_remember`, `work_workspace` y `work_delegate`;
las dos últimas están reservadas al orquestador.
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
npm test                 # contratos de los adaptadores, sin lanzar agentes reales
npm run build
```

Pruebas de concurrencia y aislamiento MCP contra una base de pruebas independiente:

```bash
SLAK_TEST_DATABASE=1 DATABASE_URL=postgres://.../slak_work_checks npx tsx --test tests/work.test.ts
```

Regresión del registro durante una migración pendiente (Postgres local con permiso
para crear bases; crea y elimina su propia base temporal):

```bash
SLAK_TEST_DATABASE=1 DATABASE_URL=postgres://...@127.0.0.1:54329/slak npx tsx --test tests/registration.test.ts
```

Crean y eliminan sus propios fixtures. El smoke nativo se validó además en una base
local aislada: mención → herramientas → respuesta → memoria → worker → intervención
directa → notificación al padre; también se revisaron escritorio y móvil.
