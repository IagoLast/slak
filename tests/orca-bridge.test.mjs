import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discover,
  executeCommand,
  taskPrompt,
  keepMachineOnline,
} from "../scripts/orca-bridge.mjs";

test("discovery publishes only explicitly shared local projects and sessions", async () => {
  const run = async (args) => {
    if (args[0] === "repo")
      return {
        repos: [
          { id: "a", path: "/a", displayName: "A" },
          { id: "private", path: "/private" },
        ],
      };
    if (args[0] === "worktree") {
      assert.equal(args[3], "id:a");
      return {
        worktrees: [
          { path: "/a/one", displayName: "One", hostId: "local" },
          { path: "/a/remote", hostId: "remote" },
        ],
      };
    }
    return {
      terminals: [
        {
          handle: "term_a",
          agentIdentity: "codex",
          connected: true,
          writable: true,
        },
      ],
    };
  };
  const catalog = await discover(
    { shareAll: false, repos: ["id:a"], worktrees: [] },
    run,
  );
  assert.deepEqual(catalog.repositories, [{ id: "id:a", name: "A" }]);
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].worktree, "path:/a/one");
  assert.equal(catalog.worktrees.length, 1);
  assert.equal(catalog.worktrees[0].worktree, "path:/a/one");
});

test("worktrees without terminal agents retain their Orca status and respect sharing limits", async () => {
  const calls = [];
  const catalog = await discover(
    { shareAll: false, repos: ["id:a"], worktrees: ["path:/a/native"] },
    async (args) => {
      calls.push(args);
      if (args[0] === "repo") return { repos: [{ id: "a", path: "/a" }] };
      if (args[0] === "worktree")
        return {
          worktrees: [
            {
              path: "/a/native",
              branch: "refs/heads/feature",
              workspaceStatus: "in-progress",
            },
            { path: "/a/private" },
            { path: "/a/archived", isArchived: true },
            { path: "/a/remote", hostId: "remote" },
          ],
        };
      return { terminals: [] };
    },
  );
  assert.deepEqual(catalog.sessions, []);
  assert.deepEqual(catalog.worktrees, [
    {
      worktree: "path:/a/native",
      name: "refs/heads/feature",
      repository: "id:a",
      branch: "feature",
      status: "in-progress",
    },
  ]);
  assert.equal(calls.filter((args) => args[0] === "terminal").length, 1);
});

test("presence remains alive during slow operations without overlapping heartbeat calls", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let count = 0;
  let finish;
  const client = {
    callTool: async ({ name }) => {
      assert.equal(name, "heartbeat");
      count++;
      await new Promise((resolve) => {
        finish = resolve;
      });
      return { content: [] };
    },
  };
  const stop = keepMachineOnline(client);
  t.mock.timers.tick(60_000);
  assert.equal(count, 1);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  assert.equal(count, 2);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  t.mock.timers.tick(60_000);
  assert.equal(count, 2);
});

test("stop closes only the selected agent terminal and never removes its worktree", async () => {
  const calls = [];
  const report = await executeCommand(
    {
      command: { id: "stop", action: "stop" },
      agent: {
        repository: "id:a",
        worktree: "path:/a/one",
        runtimeHandle: "term_a",
      },
    },
    { repositories: [{ id: "id:a" }] },
    async (args) => {
      calls.push(args);
      return {};
    },
  );
  assert.deepEqual(calls, [["terminal", "close", "--terminal", "term_a"]]);
  assert.equal(report.success, true);
});

test("a project removed from sharing cannot receive lifecycle operations", async () => {
  await assert.rejects(
    executeCommand(
      { command: { action: "stop" }, agent: { repository: "id:private" } },
      { repositories: [] },
      async () => assert.fail("Must not call Orca"),
    ),
    /ya no comparte/,
  );
});

test("start reuses an existing agent session and preserves the worktree", async () => {
  const report = await executeCommand(
    {
      command: { id: "start", action: "start" },
      agent: { repository: "id:a", worktree: "path:/a/one", provider: "codex" },
    },
    { repositories: [{ id: "id:a" }] },
    async (args) => {
      assert.deepEqual(args.slice(0, 2), ["terminal", "list"]);
      return {
        terminals: [
          {
            handle: "term_a",
            connected: true,
            writable: true,
            agentIdentity: "codex",
          },
        ],
      };
    },
  );
  assert.equal(report.runtimeHandle, "term_a");
  assert.equal(report.worktree, "path:/a/one");
});

test("creation recovers a deterministic existing checkout without duplicating it", async () => {
  const calls = [];
  const report = await executeCommand(
    {
      command: { id: "create", action: "create" },
      agent: {
        id: "12345678abcd",
        handle: "review",
        repository: "id:a",
        provider: "codex",
        worktree: "",
      },
    },
    { repositories: [{ id: "id:a" }] },
    async (args) => {
      calls.push(args);
      if (args[0] === "worktree")
        return {
          worktrees: [
            { path: "/a/review", branch: "refs/heads/slak-review-12345678" },
          ],
        };
      if (args[1] === "list") return { terminals: [] };
      return { terminal: { handle: "term_created" } };
    },
  );
  assert.equal(report.worktree, "path:/a/review");
  assert.ok(
    !calls.some((args) => args[0] === "worktree" && args[1] === "create"),
  );
  assert.equal(calls.at(-1).at(-1), "codex");
});

test("task callback contains the config path, never its credential contents", () => {
  const prompt = taskPrompt(
    { id: "task1", kind: "task", prompt: "Review the diff" },
    { messages: [] },
    "/tmp/config with ' quote.json",
  );
  assert.match(prompt, /Review the diff/);
  assert.match(prompt, /--file/);
  assert.ok(!prompt.includes("Bearer"));
});
