import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Esquema completo como DDL idempotente. Para añadir tablas o columnas,
 * añade sentencias al final (CREATE/ALTER ... IF NOT EXISTS); la versión
 * es el número de sentencias, así cualquier cambio dispara la migración.
 */
const STATEMENTS = [
  sql`CREATE TABLE IF NOT EXISTS "users" (
    "id" text PRIMARY KEY,
    "email" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "password_hash" text NOT NULL,
    "role" text NOT NULL DEFAULT 'member',
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE TABLE IF NOT EXISTS "channels" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "description" text,
    "type" text NOT NULL DEFAULT 'public',
    "created_by" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE TABLE IF NOT EXISTS "channel_members" (
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "last_read_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("channel_id", "user_id")
  )`,
  sql`CREATE INDEX IF NOT EXISTS "channel_members_user_idx"
    ON "channel_members" ("user_id")`,
  sql`CREATE TABLE IF NOT EXISTS "messages" (
    "id" text PRIMARY KEY,
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "parent_id" text,
    "content" text,
    "attachment_url" text,
    "attachment_name" text,
    "attachment_type" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS "messages_channel_created_idx"
    ON "messages" ("channel_id", "created_at")`,
  sql`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "parent_id" text`,
  sql`CREATE INDEX IF NOT EXISTS "messages_parent_idx" ON "messages" ("parent_id")`,
  sql`CREATE TABLE IF NOT EXISTS "huddle_participants" (
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "joined_at" timestamptz NOT NULL DEFAULT now(),
    "last_seen_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("channel_id", "user_id")
  )`,
  sql`CREATE TABLE IF NOT EXISTS "huddle_signals" (
    "id" text PRIMARY KEY,
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "from_user_id" text NOT NULL,
    "to_user_id" text NOT NULL,
    "payload" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS "huddle_signals_to_idx"
    ON "huddle_signals" ("channel_id", "to_user_id")`,
  sql`CREATE TABLE IF NOT EXISTS "invites" (
    "token" text PRIMARY KEY,
    "email" text,
    "role" text NOT NULL DEFAULT 'member',
    "channel_ids" jsonb NOT NULL DEFAULT '[]',
    "created_by" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "used_at" timestamptz
  )`,
];

const SCHEMA_VERSION = STATEMENTS.length;

let pending: Promise<void> | null = null;

/**
 * Crea/actualiza el esquema si hace falta. En caliente solo cuesta una
 * consulta a schema_info; tras un deploy con cambios ejecuta el DDL una vez.
 */
export function ensureSchema(force = false): Promise<void> {
  pending ??= run(force).catch((e) => {
    pending = null; // permitir reintento en la siguiente petición
    throw e;
  });
  return pending;
}

async function run(force: boolean) {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS "schema_info" ("id" int PRIMARY KEY, "version" int NOT NULL)`,
  );
  if (!force) {
    const rows = await db.execute<{ version: number }>(
      sql`SELECT "version" FROM "schema_info" WHERE "id" = 1`,
    );
    if (rows.length > 0 && rows[0].version >= SCHEMA_VERSION) return;
  }
  for (const statement of STATEMENTS) {
    await db.execute(statement);
  }
  await db.execute(
    sql`INSERT INTO "schema_info" ("id", "version") VALUES (1, ${SCHEMA_VERSION})
        ON CONFLICT ("id") DO UPDATE SET "version" = ${SCHEMA_VERSION}`,
  );
}
