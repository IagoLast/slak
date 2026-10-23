import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceGroups } from "../src/lib/workspaces";
import type { SharedMachine, WorkThreadSummary } from "../src/lib/client";

const machine: SharedMachine = {
  id: "a",
  name: "Mac",
  ownerId: "owner",
  ownerName: "Ana",
  online: false,
  enabled: true,
  lastSeenAt: null,
  repositories: [{ id: "repo", name: "Project" }],
  worktrees: [
    {
      worktree: "path:/repo/feature",
      name: "Feature",
      repository: "repo",
      branch: "feature",
      status: "in-progress",
    },
  ],
  sessions: [
    {
      worktree: "path:/repo/feature",
      name: "Feature",
      repository: "repo",
      provider: "codex",
      runtimeHandle: "term_a",
    },
  ],
};
const thread: WorkThreadSummary = {
  workers: [],
  id: "thread",
  sessionId: "parent",
  closedAt: null,
  title: "Review",
  channelId: "channel",
  rootMessageId: "root",
  worktree: "path:/repo/feature",
  handle: "bot",
  machine: "Mac",
  machineId: "a",
  repository: "repo",
  state: "waiting",
  createdAt: "2026-10-23T12:00:00Z",
  online: false,
};

test("offline worktrees stay visible and sessions do not duplicate the same worktree", () => {
  const groups = workspaceGroups([machine], [thread]);
  assert.equal(groups[0].machine.online, false);
  assert.equal(groups[0].repositories[0].worktrees.length, 1);
  assert.equal(
    groups[0].repositories[0].worktrees[0].threads[0].state,
    "waiting",
  );
});

test("identical paths on different machines do not mix their conversations", () => {
  const groups = workspaceGroups([machine, { ...machine, id: "b" }], [thread]);
  assert.equal(groups[0].repositories[0].worktrees[0].threads.length, 1);
  assert.equal(groups[1].repositories[0].worktrees[0].threads.length, 0);
});

test("guest navigation includes only worktrees from authorized conversations", () => {
  assert.deepEqual(workspaceGroups([machine], [], false), []);
  const groups = workspaceGroups(
    [machine],
    [{ ...thread, worktree: "path:/repo/allowed" }],
    false,
  );
  assert.equal(groups[0].repositories[0].worktrees.length, 1);
  assert.equal(
    groups[0].repositories[0].worktrees[0].worktree,
    "path:/repo/allowed",
  );
});

test("orchestrator conversations without a worktree remain reachable", () => {
  const groups = workspaceGroups([machine], [{ ...thread, worktree: null }]);
  assert.equal(groups[0].repositories[0].unassigned[0].id, thread.id);
});

test("a worker worktree links to its own session, independently of its parent", () => {
  const groups = workspaceGroups(
    [machine],
    [
      {
        ...thread,
        worktree: null,
        state: "idle",
        workers: [
          {
            id: "worker",
            name: "Frontend",
            worktree: "path:/repo/feature",
            state: "running",
            closedAt: null,
          },
        ],
      },
    ],
  );
  const target = groups[0].repositories[0].worktrees[0].threads[0];
  assert.equal(target.sessionId, "worker");
  assert.equal(target.state, "running");
});

test("closed worktrees do not reappear from retained conversation history", () => {
  const groups = workspaceGroups(
    [{ ...machine, worktrees: [], sessions: [] }],
    [{ ...thread, closedAt: "2026-10-23T14:00:00Z" }],
  );
  assert.deepEqual(groups[0].repositories[0].worktrees, []);
  assert.deepEqual(groups[0].repositories[0].unassigned, []);
});
