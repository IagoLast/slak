import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db } from "../src/db";
import { ensureSchema } from "../src/db/setup";
import {
  agents,
  agentTasks,
  channelMembers,
  channels,
  machines,
  users,
  workActions,
  workSessions,
  workThreads,
  workTurns,
} from "../src/db/schema";
import { openWorktreeChat } from "../src/lib/worktree-chat";
import { claimWorkTurn, queueWorkAction } from "../src/lib/work";
import { claimTask, finishTask } from "../src/lib/agents";
import { registerWorkTools } from "../src/lib/work-mcp";

if (!process.env.SLAK_TEST_DATABASE)
  throw new Error("Use an isolated test database.");
const prefix = `wt-test-${nanoid()}`;
const owner = {
  id: `${prefix}-owner`,
  name: "Owner",
  email: `${prefix}@test.invalid`,
  role: "member" as const,
};
const outsider = {
  ...owner,
  id: `${prefix}-outsider`,
  email: `${prefix}-outsider@test.invalid`,
};
const machineId = `${prefix}-machine`,
  botId = `${prefix}-parent`;
let nativeChat: { threadId: string; sessionId: string };
let client: Client, server: McpServer;
before(async () => {
  await ensureSchema();
  await db.insert(users).values(
    [
      owner,
      outsider,
      {
        ...owner,
        id: botId,
        email: `${botId}@test.invalid`,
        kind: "agent" as const,
      },
    ].map((user) => ({ ...user, passwordHash: "disabled" })),
  );
  await db.insert(machines).values({
    id: machineId,
    name: "Test",
    ownerId: owner.id,
    tokenHash: prefix,
    lastSeenAt: new Date(),
    repositories: [{ id: "id:repo", name: "Project" }],
    capabilities: ["worktree-chat.v1", "worktree-close.v1"],
    worktrees: [
      {
        worktree: "path:/feature",
        repository: "id:repo",
        name: "Feature",
        branch: "feature",
        status: "in-progress",
        identity: "wt2:local:test",
        nativeSessions: [
          { id: "native-test", name: "Existing agent", provider: "claude" },
        ],
      },
      {
        worktree: "path:/terminal",
        repository: "id:repo",
        name: "Terminal",
        branch: "terminal",
        status: "",
        nativeSessions: [],
      },
    ],
    sessions: [
      {
        worktree: "path:/terminal",
        repository: "id:repo",
        name: "Terminal",
        provider: "codex",
        runtimeHandle: "term_existing",
      },
    ],
  });
  await db.insert(agents).values({
    id: botId,
    handle: prefix,
    createdBy: owner.id,
    machineId,
    repository: "id:repo",
    mode: "orchestrator",
    state: "ready",
  });
  server = new McpServer({ name: "test", version: "1" });
  registerWorkTools(server, { machineId });
  client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
});
after(async () => {
  await client?.close();
  await server?.close();
  const createdAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.machineId, machineId));
  await db.delete(channels).where(eq(channels.createdBy, owner.id));
  await db.delete(agents).where(eq(agents.machineId, machineId));
  await db.delete(machines).where(eq(machines.id, machineId));
  await db
    .delete(users)
    .where(
      inArray(users.id, [
        owner.id,
        outsider.id,
        ...createdAgents.map((agent) => agent.id),
      ]),
    );
  await db.$client.end();
});

test("simultaneous opens reuse the existing native agent and one conversation", async () => {
  const results = await Promise.all(
    [1, 2, 3].map(() => openWorktreeChat(owner, machineId, "path:/feature")),
  );
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  nativeChat = results[0];
  const session = await db.query.workSessions.findFirst({
    where: eq(workSessions.id, nativeChat.sessionId),
  });
  assert.equal(session?.runtimeId, "native-test");
  assert.equal(session?.imported, true);
  assert.equal(session?.provider, "claude");
});

test("private worktree conversations cannot be reimported by another member or guest", async () => {
  await assert.rejects(
    openWorktreeChat(outsider, machineId, "path:/feature"),
    /no tienes acceso/,
  );
  await assert.rejects(
    openWorktreeChat(
      { ...outsider, role: "guest" },
      machineId,
      "path:/terminal",
    ),
    /Solo los miembros/,
  );
  await assert.rejects(
    openWorktreeChat(owner, machineId, "path:/unshared"),
    /ya no está compartido/,
  );
});

test("terminal worktrees reuse their agent without creating a native runtime", async () => {
  const chat = await openWorktreeChat(owner, machineId, "path:/terminal");
  assert.deepEqual(
    await openWorktreeChat(owner, machineId, "path:/terminal"),
    chat,
  );
  const session = await db.query.workSessions.findFirst({
    where: eq(workSessions.id, chat.sessionId),
  });
  assert.equal(session?.runtimeId, null);
  const bot = await db.query.agents.findFirst({
    where: eq(agents.worktree, "path:/terminal"),
  });
  assert.equal(bot?.mode, "session");
  assert.equal(bot?.runtimeHandle, "term_existing");
});

test("terminal receipts cannot update an unrelated native turn with the same request id", async () => {
  const terminal = await openWorktreeChat(owner, machineId, "path:/terminal");
  const thread = await db.query.workThreads.findFirst({
    where: eq(workThreads.id, terminal.threadId),
  });
  const id = `${prefix}-collision`;
  await db
    .insert(workTurns)
    .values({
      id,
      sessionId: nativeChat.sessionId,
      userId: owner.id,
      prompt: "Unrelated native request",
    });
  await db
    .insert(agentTasks)
    .values({
      id,
      agentId: thread!.agentId,
      channelId: thread!.channelId,
      messageId: thread!.rootMessageId,
      createdBy: owner.id,
      prompt: "Terminal request",
      kind: "message",
    });
  await claimTask(thread!.agentId, id);
  await finishTask(thread!.agentId, id, "completed", "Terminal result");
  const native = await db.query.workTurns.findFirst({
    where: eq(workTurns.id, id),
  });
  assert.equal(native?.status, "queued");
  assert.equal(native?.result, null);
});

test("closing fences all sessions in a worktree; completion preserves history and rejects stale sync", async () => {
  const secondId = `${prefix}-worker`,
    turnId = `${prefix}-turn`;
  await db.insert(workSessions).values({
    id: secondId,
    threadId: nativeChat.threadId,
    role: "worker",
    name: "Worker",
    worktree: "path:/feature",
  });
  await db.insert(workTurns).values({
    id: turnId,
    sessionId: secondId,
    userId: owner.id,
    prompt: "Pending message",
  });
  const action = await queueWorkAction(nativeChat.sessionId, "close-worktree", {
    worktree: "path:/feature",
  });
  await assert.rejects(queueWorkAction(secondId, "rotate"), /se está cerrando/);
  await assert.rejects(claimWorkTurn(secondId, turnId), /se está cerrando/);
  const stored = await db.query.workActions.findFirst({
    where: eq(workActions.id, action.id),
  });
  assert.equal(stored?.payload.identity, "wt2:local:test");
  for (const phase of ["claim", "complete", "complete"]) {
    const result = await client.callTool({
      name: "work_action",
      arguments: {
        sessionId: nativeChat.sessionId,
        actionId: action.id,
        phase,
      },
    });
    assert.ok(!result.isError, JSON.stringify(result));
  }
  const closed = await db.query.workSessions.findMany({
    where: inArray(workSessions.id, [nativeChat.sessionId, secondId]),
  });
  assert.ok(
    closed.every((session) => session.closedAt && session.state === "stopped"),
  );
  assert.equal(
    (await db.query.workTurns.findFirst({ where: eq(workTurns.id, turnId) }))
      ?.status,
    "cancelled",
  );
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, machineId),
  });
  assert.deepEqual(
    machine?.worktrees.map((tree) => tree.worktree),
    ["path:/terminal"],
  );
  assert.equal(
    (
      await db.query.workActions.findFirst({
        where: eq(workActions.id, action.id),
      })
    )?.status,
    "completed",
  );
  const stale = await client.callTool({
    name: "work_sync",
    arguments: {
      sessionId: secondId,
      generation: 1,
      state: "running",
      events: [],
    },
  });
  assert.equal(stale.isError, true);
  assert.ok(
    await db.query.channelMembers.findFirst({
      where: eq(channelMembers.userId, owner.id),
    }),
  );
});
