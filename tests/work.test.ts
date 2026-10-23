import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db } from "../src/db";
import { ensureSchema } from "../src/db/setup";
import {
  agents,
  channelMembers,
  channels,
  machines,
  messages,
  users,
  workSessions,
  workThreads,
  workTurns,
} from "../src/db/schema";
import {
  enqueueWork,
  claimWorkTurn,
  finishWorkTurn,
  delegateWork,
  saveWorkMemory,
} from "../src/lib/work";
import { registerWorkTools } from "../src/lib/work-mcp";

// Opt-in and isolated fixtures; never point this at the team's production DB.
if (!process.env.SLAK_TEST_DATABASE)
  throw new Error(
    "Indica SLAK_TEST_DATABASE=1 y DATABASE_URL de una base de pruebas.",
  );
const prefix = `test-${nanoid()}`;
const human = `${prefix}-human`,
  bot = `${prefix}-bot`,
  machine = `${prefix}-machine`,
  channel = `${prefix}-channel`,
  root = `${prefix}-root`;
let threadId: string, sessionId: string;
before(async () => {
  await ensureSchema();
  await db.insert(users).values([
    {
      id: human,
      name: "Ana",
      email: `${human}@test.invalid`,
      passwordHash: "disabled",
    },
    {
      id: bot,
      name: "Bot",
      email: `${bot}@test.invalid`,
      passwordHash: "disabled",
      kind: "agent",
      role: "guest",
    },
  ]);
  await db.insert(machines).values({
    id: machine,
    name: "Test",
    ownerId: human,
    tokenHash: prefix,
    repositories: [{ id: "id:test", name: "Test" }],
  });
  await db.insert(agents).values({
    id: bot,
    handle: prefix,
    mode: "orchestrator",
    machineId: machine,
    repository: "id:test",
    createdBy: human,
    state: "ready",
  });
  await db
    .insert(channels)
    .values({ id: channel, name: "Test", type: "private" });
  await db.insert(channelMembers).values([
    { channelId: channel, userId: human },
    { channelId: channel, userId: bot },
  ]);
  await db.insert(messages).values({
    id: root,
    channelId: channel,
    userId: human,
    content: "Explora",
  });
});
after(async () => {
  await db.delete(channels).where(eq(channels.id, channel));
  await db.delete(agents).where(eq(agents.id, bot));
  await db.delete(machines).where(eq(machines.id, machine));
  await db.delete(users).where(eq(users.id, bot));
  await db.delete(users).where(eq(users.id, human));
  await db.$client.end();
});

test("simultaneous replies share one coordinator; messages are FIFO and completion is idempotent", async () => {
  await Promise.all(
    [1, 2].map(async (n) =>
      db.transaction(async (tx) => {
        const messageId = `${prefix}-message-${n}`;
        await tx.insert(messages).values({
          id: messageId,
          parentId: root,
          channelId: channel,
          userId: human,
          content: `Reply ${n}`,
        });
        await enqueueWork(tx, {
          agentId: bot,
          channelId: channel,
          messageId,
          userId: human,
          prompt: `Reply ${n}`,
        });
      }),
    ),
  );
  const threads = await db
    .select()
    .from(workThreads)
    .where(eq(workThreads.rootMessageId, root));
  assert.equal(threads.length, 1);
  threadId = threads[0].id;
  const sessions = await db
    .select()
    .from(workSessions)
    .where(eq(workSessions.threadId, threadId));
  assert.equal(sessions.length, 1);
  sessionId = sessions[0].id;
  const turns = (
    await db.select().from(workTurns).where(eq(workTurns.sessionId, sessionId))
  ).sort((a, b) => +a.createdAt - +b.createdAt || a.id.localeCompare(b.id));
  await assert.rejects(claimWorkTurn(sessionId, turns[1].id));
  const claims = await Promise.allSettled([
    claimWorkTurn(sessionId, turns[0].id),
    claimWorkTurn(sessionId, turns[0].id),
  ]);
  assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
  const results = await Promise.all([
    finishWorkTurn(turns[0].id, "Hecho", "completed"),
    finishWorkTurn(turns[0].id, "Hecho", "completed"),
  ]);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const replies = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, bot));
  assert.equal(replies.length, 1);
  await claimWorkTurn(sessionId, turns[1].id);
  await finishWorkTurn(turns[1].id, "Segundo", "completed");
});

test("a direct conversation reuses the project parent without sharing another channel's context", async () => {
  const dm = `${prefix}-dm`;
  await db.insert(channels).values({ id: dm, name: "dm", type: "dm" });
  try {
    const results = await Promise.all(
      [1, 2].map((n) =>
        db.transaction(async (tx) => {
          const messageId = `${prefix}-dm-${n}`;
          await tx
            .insert(messages)
            .values({
              id: messageId,
              channelId: dm,
              userId: human,
              content: `Request ${n}`,
            });
          return enqueueWork(tx, {
            agentId: bot,
            channelId: dm,
            messageId,
            userId: human,
            prompt: `Request ${n}`,
          });
        }),
      ),
    );
    assert.equal(results[0].id, results[1].id);
    assert.notEqual(results[0].id, threadId);
  } finally {
    await db.delete(channels).where(eq(channels.id, dm));
  }
});

test("workers have independent queues, notify parent, and cannot overwrite newer durable memory", async () => {
  const child = await delegateWork(sessionId, "Backend", "Explora API", human);
  const [turn] = await db
    .select()
    .from(workTurns)
    .where(eq(workTurns.sessionId, child.id));
  await claimWorkTurn(child.id, turn.id);
  await finishWorkTurn(turn.id, "API revisada", "completed");
  const parentTurns = await db
    .select()
    .from(workTurns)
    .where(eq(workTurns.sessionId, sessionId));
  assert.equal(parentTurns.filter((t) => t.kind === "notification").length, 1);
  assert.deepEqual(
    await saveWorkMemory(sessionId, "Mantener compatibilidad", 0),
    { version: 1 },
  );
  await assert.rejects(saveWorkMemory(sessionId, "Memoria vieja", 0));
  const server = new McpServer({ name: "test", version: "1" });
  registerWorkTools(server, { sessionId: child.id });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(a);
  await client.connect(b);
  try {
    assert.equal(
      (
        await client.callTool({
          name: "work_context",
          arguments: { sessionId },
        })
      ).isError,
      true,
    );
    assert.notEqual(
      (
        await client.callTool({
          name: "work_context",
          arguments: { sessionId: child.id },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "work_delegate",
          arguments: { sessionId: child.id, name: "Not allowed", prompt: "No" },
        })
      ).isError,
      true,
    );
    await db.delete(channelMembers).where(eq(channelMembers.userId, bot));
    assert.equal(
      (
        await client.callTool({
          name: "work_context",
          arguments: { sessionId: child.id },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
