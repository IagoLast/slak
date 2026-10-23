import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

// Opt-in: creates and removes only its own temporary database on local Postgres.
if (process.env.SLAK_TEST_DATABASE !== "1" || !process.env.DATABASE_URL)
  throw new Error("Indica SLAK_TEST_DATABASE=1 y DATABASE_URL de Postgres local.");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Estas pruebas requieren Postgres local.");
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
const database = `slak_registration_${randomUUID().replaceAll("-", "")}`;
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
const connection = postgres(url.toString(), { max: 1, onnotice: () => {} });
let appDb: typeof import("../src/db").db;
let register: typeof import("../src/app/api/register/route").POST;
let ensureSchema: typeof import("../src/db/setup").ensureSchema;

function request(email: string, token?: string) {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", email, password: "test-password-only", token }),
  });
}

before(async () => {
  await admin`CREATE DATABASE ${admin(database)}`;
  // Reproduce the production schema before users.kind / last_seen_at existed.
  await connection`CREATE TABLE users (
    id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
    password_hash text NOT NULL, role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  ({ db: appDb } = await import("../src/db"));
  ({ POST: register } = await import("../src/app/api/register/route"));
  ({ ensureSchema } = await import("../src/db/setup"));
});

after(async () => {
  if (appDb) await appDb.$client.end();
  await connection.end();
  await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
  await admin.end();
});

test("registration waits for an in-flight migration before reading users", async () => {
  await connection`SELECT pg_advisory_lock(1936482667, 1)`;
  let completed = false;
  const migration = ensureSchema();
  const response = register(request("admin@test.invalid")).finally(() => { completed = true; });
  // The request must wait behind the migration, not query the legacy table.
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(completed, false);
  } finally {
    await connection`SELECT pg_advisory_unlock(1936482667, 1)`;
  }
  await migration;
  assert.equal((await response).status, 200);
  const [user] = await connection`SELECT id, role, kind FROM users WHERE email = 'admin@test.invalid'`;
  assert.equal(user.role, "admin");
  assert.equal(user.kind, "human");
  const [membership] = await connection`SELECT c.name FROM channels c
    JOIN channel_members m ON m.channel_id = c.id WHERE m.user_id = ${user.id}`;
  assert.equal(membership.name, "general");
});

test("registration still enforces duplicates and invitations after migration", async () => {
  assert.equal((await register(request("admin@test.invalid"))).status, 409);
  assert.equal((await register(request("member@test.invalid"))).status, 403);
  assert.equal((await register(request("member@test.invalid", "invalid"))).status, 400);
  await connection`INSERT INTO invites (token, role, channel_ids)
    SELECT 'registration-test-invite', 'member', jsonb_build_array(id) FROM channels WHERE name = 'general'`;
  assert.equal((await register(request("member@test.invalid", "registration-test-invite"))).status, 200);
  const [user] = await connection`SELECT role, kind FROM users WHERE email = 'member@test.invalid'`;
  assert.equal(user.role, "member");
  assert.equal(user.kind, "human");
  assert.equal((await register(request("another@test.invalid", "registration-test-invite"))).status, 400);
});

test("forced setup repairs drift even when schema readiness was already cached", async () => {
  await connection`ALTER TABLE users DROP COLUMN kind`;
  await ensureSchema(true);
  const users = await connection`SELECT kind FROM users`;
  assert.equal(users.length, 2);
  assert.ok(users.every((user) => user.kind === "human"));
});

test("an invitation can only be consumed once by concurrent registrations", async () => {
  await connection`INSERT INTO invites (token, role) VALUES ('single-use-invite', 'member')`;
  const responses = await Promise.all([
    register(request("concurrent-a@test.invalid", "single-use-invite")),
    register(request("concurrent-b@test.invalid", "single-use-invite")),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  const accounts = await connection`SELECT id FROM users WHERE email IN ('concurrent-a@test.invalid', 'concurrent-b@test.invalid')`;
  assert.equal(accounts.length, 1);
});

test("an email-restricted guest invite grants only its selected channels", async () => {
  const [general] = await connection`SELECT id FROM channels WHERE name = 'general'`;
  await connection`INSERT INTO invites (token, email, role, channel_ids)
    VALUES ('guest-invite', 'guest@test.invalid', 'guest', ${connection.json([general.id])})`;
  assert.equal((await register(request("wrong@test.invalid", "guest-invite"))).status, 400);
  assert.equal((await register(request("guest@test.invalid", "guest-invite"))).status, 200);
  const [guest] = await connection`SELECT id, role FROM users WHERE email = 'guest@test.invalid'`;
  assert.equal(guest.role, "guest");
  const memberships = await connection`SELECT channel_id FROM channel_members WHERE user_id = ${guest.id}`;
  assert.deepEqual(memberships.map((m) => m.channel_id), [general.id]);
});
