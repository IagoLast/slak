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
  // Presencia online/offline.
  sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz NOT NULL DEFAULT now()`,
  sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'human'`,
  sql`CREATE TABLE IF NOT EXISTS "agents" (
    "id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
    "handle" text NOT NULL UNIQUE,
    "description" text NOT NULL DEFAULT '',
    "machine" text NOT NULL DEFAULT '',
    "token_hash" text UNIQUE,
    "created_by" text NOT NULL REFERENCES "users"("id"),
    "last_seen_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" text PRIMARY KEY,
    "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "message_id" text NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
    "created_by" text NOT NULL REFERENCES "users"("id"),
    "kind" text NOT NULL DEFAULT 'task',
    "prompt" text NOT NULL,
    "status" text NOT NULL DEFAULT 'queued',
    "result" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS "agent_tasks_inbox_idx" ON "agent_tasks" ("agent_id", "status", "created_at")`,
  sql`CREATE TABLE IF NOT EXISTS "machines" (
    "id" text PRIMARY KEY, "name" text NOT NULL,
    "owner_id" text NOT NULL REFERENCES "users"("id"), "token_hash" text UNIQUE,
    "repositories" jsonb NOT NULL DEFAULT '[]', "last_seen_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "machine_id" text REFERENCES "machines"("id")`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "worktree" text NOT NULL DEFAULT ''`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "repository" text NOT NULL DEFAULT ''`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'codex'`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "runtime_handle" text`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "state" text NOT NULL DEFAULT 'external'`,
  sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "error" text`,
  sql`CREATE TABLE IF NOT EXISTS "machine_commands" (
    "id" text PRIMARY KEY, "machine_id" text NOT NULL REFERENCES "machines"("id") ON DELETE CASCADE,
    "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
    "action" text NOT NULL, "status" text NOT NULL DEFAULT 'queued',
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "agent_one_running_task" ON "agent_tasks" ("agent_id") WHERE "status" = 'running'`,
  sql`ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "sessions" jsonb NOT NULL DEFAULT '[]'`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "agent_machine_worktree" ON "agents" ("machine_id", "worktree") WHERE "worktree" <> '' AND "machine_id" IS NOT NULL`,
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
