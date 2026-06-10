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
5. Crea las tablas: en tu máquina, con el `DATABASE_URL` de producción en `.env`:
   ```bash
   npm install
   npm run db:push
   ```
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

| Rol | Permisos |
| --- | --- |
| `admin` | Todo: crear canales, invitar miembros e invitados externos |
| `member` | Ver todos los canales públicos, crear canales, DMs, subir archivos |
| `guest` (externo) | Solo los canales a los que ha sido añadido, y DMs |

## Límites conocidos (a propósito, para mantenerlo simple)

- Los mensajes se actualizan por polling cada ~2,5 s; no hay websockets.
- Archivos hasta 4 MB (límite del cuerpo de las funciones de Vercel).
- Las notificaciones son del navegador (no push móvil) y solo con la app abierta.
