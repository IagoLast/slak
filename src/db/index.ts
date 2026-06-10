import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// La integración de Neon en Vercel crea POSTGRES_URL; en local usamos DATABASE_URL.
const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

// prepare: false is required for connection poolers (Neon, Supabase, pgbouncer)
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
