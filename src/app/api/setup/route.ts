import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

// Crea las tablas si no existen. Es idempotente y no toca datos existentes,
// por lo que es seguro dejarlo accesible: basta visitar /api/setup una vez
// tras el primer despliegue (sustituye a `npm run db:push`).
const statements = [
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
  sql`CREATE TABLE IF NOT EXISTS "messages" (
    "id" text PRIMARY KEY,
    "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "content" text,
    "attachment_url" text,
    "attachment_name" text,
    "attachment_type" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS "messages_channel_created_idx"
    ON "messages" ("channel_id", "created_at")`,
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

export async function GET() {
  try {
    for (const statement of statements) {
      await db.execute(statement);
    }
    return NextResponse.json({
      ok: true,
      message: "Tablas creadas. Ya puedes ir a /register y crear tu cuenta.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Error desconocido",
        hint: "Comprueba que DATABASE_URL o POSTGRES_URL está configurada en Vercel.",
      },
      { status: 500 },
    );
  }
}
