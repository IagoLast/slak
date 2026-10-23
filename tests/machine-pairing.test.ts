import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { SessionUser } from "../src/lib/session";

if (process.env.SLAK_TEST_DATABASE !== "1" || !process.env.DATABASE_URL)
  throw new Error(
    "Indica SLAK_TEST_DATABASE=1 y DATABASE_URL de Postgres local.",
  );
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Estas pruebas requieren Postgres local.");
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
const database = `slak_pairing_${randomUUID().replaceAll("-", "")}`;
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
const connection = postgres(url.toString(), { max: 1, onnotice: () => {} });
let appDb: typeof import("../src/db").db;
let pairing: typeof import("../src/lib/machine-pairing");
const member: SessionUser = {
  id: "member",
  name: "Member",
  email: "member@test.invalid",
  role: "member",
};
const other: SessionUser = { ...member, id: "other" };
const guest: SessionUser = { ...member, id: "guest", role: "guest" };

before(async () => {
  await admin`CREATE DATABASE ${admin(database)}`;
  ({ db: appDb } = await import("../src/db"));
  const { ensureSchema } = await import("../src/db/setup");
  await ensureSchema();
  pairing = await import("../src/lib/machine-pairing");
  for (const user of [member, other, guest])
    await connection`INSERT INTO users (id, name, email, password_hash, role)
      VALUES (${user.id}, ${user.name}, ${user.id + "@test.invalid"}, 'unused-test-only', ${user.role})`;
});

after(async () => {
  if (appDb) await appDb.$client.end();
  await connection.end();
  await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
  await admin.end();
});

test("abandoned setup creates no machine; a code can be consumed only once concurrently", async () => {
  const command = await pairing.createMachinePairing(member);
  const [{ count }] =
    await connection`SELECT count(*)::int AS count FROM machines`;
  assert.equal(count, 0);
  const results = await Promise.allSettled([
    pairing.redeemMachinePairing(command.code, "My Mac"),
    pairing.redeemMachinePairing(command.code, "My Mac"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const [machine] =
    await connection`SELECT name, owner_id, token_hash FROM machines`;
  assert.equal(machine.name, "My Mac");
  assert.equal(machine.owner_id, member.id);
  assert.equal(machine.token_hash.length, 64);
  await assert.rejects(
    pairing.inspectMachinePairing(command.code),
    /caducado o ya se usó/,
  );
});

test("expired or replaced commands cannot create a machine", async () => {
  const expired = await pairing.createMachinePairing(member);
  await connection`UPDATE machine_pairings SET expires_at = now() - interval '1 second' WHERE id = ${expired.id}`;
  await assert.rejects(
    pairing.redeemMachinePairing(expired.code, "Mac"),
    /caducado/,
  );
  const replaced = await pairing.createMachinePairing(member);
  await pairing.createMachinePairing(member);
  await assert.rejects(
    pairing.redeemMachinePairing(replaced.code, "Mac"),
    /caducado/,
  );
});

test("permissions are checked at creation and again at redemption", async () => {
  await assert.rejects(
    pairing.createMachinePairing(guest),
    /Solo los miembros/,
  );
  const [machine] = await connection`SELECT id FROM machines LIMIT 1`;
  await assert.rejects(
    pairing.createMachinePairing(other, machine.id),
    /Sin permiso/,
  );
  const pending = await pairing.createMachinePairing(other);
  await connection`UPDATE users SET role = 'guest' WHERE id = ${other.id}`;
  await assert.rejects(
    pairing.redeemMachinePairing(pending.code, "Mac"),
    /Ya no tienes permiso/,
  );
  await connection`UPDATE users SET role = 'member' WHERE id = ${other.id}`;
});

test("reconnection preserves the machine identity and rotates its token only on redemption", async () => {
  const [previous] =
    await connection`SELECT id, token_hash, name FROM machines LIMIT 1`;
  const command = await pairing.createMachinePairing(member, previous.id);
  assert.equal(
    (await pairing.inspectMachinePairing(command.code)).machineId,
    previous.id,
  );
  const [pending] =
    await connection`SELECT token_hash FROM machines WHERE id = ${previous.id}`;
  assert.equal(pending.token_hash, previous.token_hash);
  const identity = await pairing.redeemMachinePairing(
    command.code,
    "Different hostname",
  );
  assert.equal(identity.id, previous.id);
  const [updated] =
    await connection`SELECT token_hash, name FROM machines WHERE id = ${previous.id}`;
  assert.notEqual(updated.token_hash, previous.token_hash);
  assert.equal(updated.name, previous.name);
});
