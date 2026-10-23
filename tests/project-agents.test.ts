import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/db";
import { ensureSchema } from "../src/db/setup";
import { agents, machines, users } from "../src/db/schema";
import { ensureProjectAgents } from "../src/lib/agents";

if (!process.env.SLAK_TEST_DATABASE)
  throw new Error("Use an isolated test database.");
const owner = `parent-test-${nanoid()}`;
const machine = { id: `${owner}-machine`, name: "Mac", ownerId: owner };
before(async () => {
  await ensureSchema();
  await db
    .insert(users)
    .values({
      id: owner,
      name: "Test",
      email: `${owner}@test.invalid`,
      passwordHash: "disabled",
    });
  await db.insert(machines).values(machine);
});
after(async () => {
  const created = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.machineId, machine.id));
  await db.delete(agents).where(eq(agents.machineId, machine.id));
  await db.delete(machines).where(eq(machines.id, machine.id));
  await db
    .delete(users)
    .where(inArray(users.id, [owner, ...created.map((agent) => agent.id)]));
  await db.$client.end();
});

test("concurrent heartbeats create one stable parent per shared project", async () => {
  const repositories = [
    { id: "id:a", name: "A" },
    { id: "id:b", name: "B" },
  ];
  await Promise.all(
    [1, 2, 3].map(() =>
      db.transaction(async (tx) => {
        await tx
          .select()
          .from(machines)
          .where(eq(machines.id, machine.id))
          .for("update");
        await ensureProjectAgents(tx, machine, repositories);
      }),
    ),
  );
  const parents = await db
    .select()
    .from(agents)
    .where(eq(agents.machineId, machine.id));
  assert.equal(parents.length, 2);
  assert.deepEqual(
    new Set(parents.map((agent) => agent.repository)),
    new Set(["id:a", "id:b"]),
  );
  assert.ok(
    parents.every(
      (agent) => agent.mode === "orchestrator" && agent.state === "ready",
    ),
  );
  await db.transaction((tx) => ensureProjectAgents(tx, machine, repositories));
  const again = await db
    .select()
    .from(agents)
    .where(eq(agents.machineId, machine.id));
  assert.deepEqual(
    again.map((agent) => agent.id).sort(),
    parents.map((agent) => agent.id).sort(),
  );
});
