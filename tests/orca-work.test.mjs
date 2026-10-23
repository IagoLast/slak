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
  assert.match(first, /Eres el orquestador/);
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

test("the parent stays on the project and each new worker receives its own reusable worktree", async () => {
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
      worktree: null,
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
    assert.equal(bindings.get("parent"), "path:/project");
    assert.equal(bindings.get("one"), "path:/project/slak-worker-one");
    assert.equal(bindings.get("two"), "path:/project/slak-worker-two");
    assert.equal(new Set(nativeCreates).size, 3);
    await tick({}, { repositories: [{ id: "id:repo" }] });
    assert.equal(created.length, 2);
    assert.equal(nativeCreates.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
