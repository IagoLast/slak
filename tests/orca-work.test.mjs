import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkBridge, workPrompt } from "../scripts/orca-work.mjs";

test("only the first message restores instructions and memory; follow-ups preserve the message with minimal Slak metadata", () => {
  const entry = {
    session: { role: "orchestrator" },
    bot: { handle: "parent", description: "Project parent" },
  };
  const turn = {
    id: "current",
    kind: "human",
    prompt: "Ahora cambia el título.\nGracias.",
  };
  const context = {
    worktree: "path:/project/feature",
    objective: "Original objective",
    memory: "Durable context",
    memoryVersion: 1,
    sessions: [],
    turns: [
      { id: "current", author: "Iago" },
      {
        id: "old",
        status: "completed",
        prompt: "Earlier request",
        result: "Earlier result",
      },
    ],
  };
  const first = workPrompt(entry, turn, context, "/config.json");
  assert.match(first, /conversación de Orca/);
  assert.doesNotMatch(first, /orquestador|delegate|agente padre/);
  assert.match(first, /Durable context/);
  assert.match(first, /Earlier result/);
  const followUp = workPrompt(entry, turn, context, "/config.json", false);
  assert.equal(
    followUp,
    `${JSON.stringify({ source: "Slak", author: "Iago", kind: "human", worktree: context.worktree })}\n\n${turn.prompt}`,
  );
  const notification = workPrompt(
    entry,
    { ...turn, kind: "notification" },
    context,
    "/config.json",
    false,
  );
  assert.equal(JSON.parse(notification.split("\n")[0]).kind, "notification");
});

test("new sessions use their selected worktrees without creating additional checkouts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-workers-"));
  const created = [];
  const nativeCreates = [];
  const bindings = new Map();
  const entries = ["parent", "one", "two"].map((id) => ({
    session: {
      id,
      name: id,
      generation: 1,
      role: id === "parent" ? "orchestrator" : "worker",
      state: "idle",
      runtimeId: null,
      worktree: `path:/project/${id}`,
    },
    thread: { id: "thread", repository: "id:repo", worktree: null },
    bot: { state: "ready", provider: "codex", handle: "parent" },
  }));
  const tick = createWorkBridge({
    config: { url: "http://localhost/api/mcp", token: "test-only-token" },
    configPath: join(dir, "config.json"),
    state: {},
    save: async () => {},
    call: async (_client, method, args) => {
      if (method === "work_inbox")
        return {
          sessions: entries,
          turns: entries.map(({ session }) => ({
            id: `turn-${session.id}`,
            sessionId: session.id,
            status: "queued",
          })),
          actions: [],
        };
      if (method === "work_bind") bindings.set(args.sessionId, args.worktree);
      if (method === "work_sync")
        assert.notEqual(args.state, "error", args.error);
      return {};
    },
    run: async (args) => {
      if (args[0] === "repo")
        return { repos: [{ id: "repo", path: "/project" }] };
      if (args[1] === "list") return { worktrees: created };
      assert.equal(args[1], "create");
      const name = args[args.indexOf("--name") + 1];
      const worktree = { path: `/project/${name}`, displayName: name };
      created.push(worktree);
      return { worktree };
    },
    runtimeLoader: async () => ({
      call: async (method, args) => {
        if (method === "agentSession.createSupport") return { supported: true };
        if (method === "agentSession.create") {
          nativeCreates.push(args.worktree);
          return { fence: 1 };
        }
        assert.equal(method, "agentSession.history");
        return {
          page: {
            items: [],
            fence: 1,
            epoch: "test",
            liveCursor: { epoch: "test", sequence: 0 },
            hasOlder: false,
            working: true,
            actionablePromptIds: [],
          },
        };
      },
    }),
  });
  try {
    await tick({}, { repositories: [{ id: "id:repo" }] });
    assert.equal(bindings.get("parent"), "path:/project/parent");
    assert.equal(bindings.get("one"), "path:/project/one");
    assert.equal(bindings.get("two"), "path:/project/two");
    assert.equal(new Set(nativeCreates).size, 3);
    await tick({}, { repositories: [{ id: "id:repo" }] });
    assert.equal(created.length, 0);
    assert.equal(nativeCreates.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("closing suspends and archives the exact workspace without deleting files", async () => {
  const { closeWorktree } = await import("../scripts/orca-work.mjs");
  const calls = [];
  let archived = false;
  await closeWorktree(
    {
      call: async (method, args) => {
        calls.push([method, args]);
        if (method === "worktree.set") archived = args.isArchived;
        return {
          worktree: {
            path: "/project/feature",
            repoId: "repo",
            hostId: "local",
            identity: { key: "wt2:local:one" },
            isArchived: archived,
          },
        };
      },
    },
    { thread: { repository: "id:repo" } },
    { worktree: "path:/project/feature", identity: "wt2:local:one" },
    {
      repositories: [{ id: "id:repo" }],
      worktrees: [{ worktree: "path:/project/feature", repository: "id:repo" }],
    },
  );
  assert.deepEqual(
    calls.map(([method]) => method),
    ["worktree.show", "worktree.sleep", "worktree.set", "worktree.show"],
  );
  assert.equal(calls[1][1].worktree, "identity:wt2:local:one");
});

test("close refuses changed identities and a narrower sharing selection before stopping anything", async () => {
  const { closeWorktree } = await import("../scripts/orca-work.mjs");
  const catalog = {
    repositories: [{ id: "id:repo" }],
    worktrees: [{ worktree: "path:/feature", repository: "id:repo" }],
  };
  const entry = { thread: { repository: "id:repo" } };
  const payload = { worktree: "path:/feature", identity: "old" };
  const native = {
    call: async (method) => {
      assert.equal(method, "worktree.show");
      return {
        worktree: {
          path: "/feature",
          repoId: "repo",
          identity: { key: "replacement" },
        },
      };
    },
  };
  await assert.rejects(
    closeWorktree(native, entry, payload, catalog),
    /cambió/,
  );
  await assert.rejects(
    closeWorktree(
      { call: () => assert.fail("Must not call Orca") },
      entry,
      payload,
      catalog,
      ["path:/other"],
    ),
    /no está compartido/,
  );
});

test("a shutdown failure never archives a worktree or reports success", async () => {
  const { closeWorktree } = await import("../scripts/orca-work.mjs");
  const calls = [];
  await assert.rejects(
    closeWorktree(
      {
        call: async (method) => {
          calls.push(method);
          if (method === "worktree.sleep")
            throw new Error("shutdown unverified");
          return { worktree: { path: "/feature", repoId: "repo" } };
        },
      },
      { thread: { repository: "id:repo" } },
      { worktree: "path:/feature" },
      {
        repositories: [{ id: "id:repo" }],
        worktrees: [{ worktree: "path:/feature", repository: "id:repo" }],
      },
    ),
    /shutdown unverified/,
  );
  assert.deepEqual(calls, ["worktree.show", "worktree.sleep"]);
});

test("imported conversations preserve the existing agent's context and receive only the new message", () => {
  const prompt = workPrompt(
    {
      session: { role: "orchestrator", imported: true },
      bot: { handle: "parent" },
    },
    { id: "turn", kind: "human", prompt: "Sigue con la revisión" },
    { turns: [], worktree: "path:/feature" },
    "/unused",
    true,
  );
  assert.match(prompt, /Sigue con la revisión/);
  assert.doesNotMatch(prompt, /Eres|delegate|remember/);
});

test("opening an imported chat synchronizes its existing runtime without creating or prompting an agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-import-"));
  const entry = {
    session: {
      id: "imported",
      generation: 1,
      role: "orchestrator",
      state: "idle",
      runtimeId: "native-existing",
      worktree: "path:/project/feature",
      imported: true,
    },
    thread: {
      id: "thread",
      repository: "id:repo",
      worktree: "path:/project/feature",
    },
    bot: { state: "ready", mode: "orchestrator", provider: "codex" },
  };
  let synced;
  const tick = createWorkBridge({
    config: { token: "test", url: "http://localhost/api/mcp" },
    configPath: join(dir, "config.json"),
    state: {},
    save: async () => {},
    call: async (_client, name, args) => {
      if (name === "work_inbox")
        return { sessions: [entry], turns: [], actions: [] };
      if (name === "work_sync") synced = args;
      return {};
    },
    run: async (args) => {
      assert.deepEqual(args, ["repo", "list"]);
      return { repos: [{ id: "repo", path: "/project" }] };
    },
    runtimeLoader: async () => ({
      call: async (method, args) => {
        assert.equal(method, "agentSession.history");
        assert.equal(args.sessionId, "native-existing");
        return {
          page: {
            items: [
              {
                itemId: "original-user",
                revision: 1,
                sequence: 1,
                observedAt: 0,
                body: {
                  kind: "message",
                  role: "user",
                  blocks: [{ type: "text", text: "Original request" }],
                },
              },
            ],
            fence: 1,
            epoch: "test",
            liveCursor: { epoch: "test", sequence: 1 },
            hasOlder: false,
            working: false,
            actionablePromptIds: [],
          },
        };
      },
    }),
  });
  try {
    await tick({}, { repositories: [{ id: "id:repo" }] });
    assert.equal(synced.state, "idle");
    assert.equal(synced.events[0].body.role, "user");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an interrupted close without a receipt is reported, never silently retried", async () => {
  const reports = [];
  const entry = {
    session: {
      id: "worker",
      generation: 1,
      role: "worker",
      worktree: "path:/feature",
    },
    thread: { repository: "id:repo" },
    bot: {},
  };
  const tick = createWorkBridge({
    config: {},
    configPath: "/unused",
    state: {},
    save: async () => {},
    run: () => assert.fail("Must not call Orca"),
    call: async (_client, name, args) => {
      if (name === "work_inbox")
        return {
          sessions: [entry],
          turns: [{ id: "queued", sessionId: "worker", status: "queued" }],
          actions: [
            {
              id: "close",
              sessionId: "worker",
              kind: "close-worktree",
              status: "running",
              payload: { worktree: "path:/feature" },
            },
          ],
        };
      reports.push(args);
      return {};
    },
    runtimeLoader: async () => ({
      call: () => assert.fail("Must not call Orca"),
    }),
  });
  await tick({}, { repositories: [{ id: "id:repo" }] });
  assert.equal(reports[0].phase, "fail");
  assert.match(reports[0].error, /interrumpió/);
});

test("interrupt cancels only the selected runtime without closing or replacing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-interrupt-"));
  const calls = [],
    reports = [];
  const entry = {
    session: {
      id: "selected",
      generation: 1,
      role: "orchestrator",
      state: "running",
      runtimeId: "existing",
      worktree: "path:/project/feature",
      imported: true,
    },
    thread: {
      id: "thread",
      repository: "id:repo",
      worktree: "path:/project/feature",
    },
    bot: { state: "ready", mode: "orchestrator", provider: "codex" },
  };
  const tick = createWorkBridge({
    config: { token: "test", url: "http://localhost/api/mcp" },
    configPath: join(dir, "config.json"),
    state: {},
    save: async () => {},
    call: async (_client, name, args) => {
      if (name === "work_inbox") {
        assert.ok(args.capabilities.includes("session-interrupt.v1"));
        return {
          sessions: [entry],
          turns: [{ id: "pending", sessionId: "selected", status: "queued" }],
          actions: [
            {
              id: "interrupt",
              sessionId: "selected",
              kind: "interrupt",
              status: "queued",
              payload: {},
            },
          ],
        };
      }
      if (name === "work_action") reports.push(args);
      if (name === "work_sync")
        assert.notEqual(args.state, "error", args.error);
      return {};
    },
    run: async () => ({ repos: [{ id: "repo", path: "/project" }] }),
    runtimeLoader: async () => ({
      call: async (method, args) => {
        calls.push(method);
        assert.equal(args.sessionId || args.envelope?.sessionId, "existing");
        if (method === "agentSession.cancel") return { value: {}, fence: 1 };
        assert.equal(method, "agentSession.history");
        return {
          page: {
            items: [],
            fence: 1,
            epoch: "test",
            liveCursor: { epoch: "test", sequence: 0 },
            hasOlder: false,
            working: true,
            actionablePromptIds: [],
          },
        };
      },
    }),
  });
  try {
    await tick({}, { repositories: [{ id: "id:repo" }] });
    assert.deepEqual(calls, ["agentSession.history", "agentSession.cancel"]);
    assert.deepEqual(
      reports.map((report) => report.phase),
      ["claim", "complete"],
      JSON.stringify(reports),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unavailable runtime reports an interrupt failure instead of leaving the action pending", async () => {
  const reports = [];
  const tick = createWorkBridge({
    config: {},
    configPath: "/unused",
    state: {},
    save: async () => {},
    run: () => assert.fail("No runtime"),
    runtimeLoader: async () => {
      throw new Error("Runtime unavailable");
    },
    call: async (_client, name, args) => {
      if (name === "work_inbox")
        return {
          sessions: [
            { session: { id: "selected" }, bot: { mode: "orchestrator" } },
          ],
          turns: [],
          actions: [
            {
              id: "interrupt",
              sessionId: "selected",
              kind: "interrupt",
              status: "queued",
            },
          ],
        };
      reports.push(args);
      return {};
    },
  });
  await tick({}, {});
  assert.deepEqual(
    reports.map((report) => report.phase),
    ["claim", "fail"],
  );
  assert.equal(reports[1].error, "Runtime unavailable");
});
