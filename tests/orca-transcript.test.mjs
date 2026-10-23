import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archivedTerminalSource, terminalTranscriptBatches, transcriptMessage } from "../scripts/orca-transcript.mjs";
import { createWorkBridge } from "../scripts/orca-work.mjs";

const timestamp = "2026-10-23T14:00:00.000Z";
const message = (role, text) => ({
  timestamp, type: "response_item",
  payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
});

test("imports conversation text without internal instructions, tools or duplicate provider events", () => {
  assert.equal(transcriptMessage(message("user", "Hola"), "codex").body.blocks[0].text, "Hola");
  assert.equal(transcriptMessage(message("developer", "Private instructions"), "codex"), null);
  assert.equal(transcriptMessage({ timestamp, type: "event_msg", payload: { type: "agent_message", message: "Duplicate" } }, "codex"), null);
  assert.equal(transcriptMessage(message("user", "<environment_context>private</environment_context>"), "codex"), null);
  assert.equal(transcriptMessage({ timestamp, type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "Private" }, { type: "text", text: "Respuesta" }, { type: "tool_use", input: { secret: "hidden" } }] } }, "claude").body.blocks[0].text, "Respuesta");
});

test("recovers old terminal messages and resumes after complete lines without duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-history-"));
  const transcriptPath = join(dir, "session.jsonl");
  const source = { id: "provider-session", transcriptPath };
  const partial = JSON.stringify(message("assistant", "Respuesta"));
  try {
    await writeFile(transcriptPath, JSON.stringify(message("user", "Mensaje anterior")) + "\n" + partial.slice(0, 35));
    const batches = [];
    for await (const batch of terminalTranscriptBatches(source, "codex", 1)) batches.push(batch);
    assert.equal(batches.flatMap(b => b.events).length, 1);
    const cursor = batches.at(-1).cursor;
    await appendFile(transcriptPath, partial.slice(35) + "\n");
    const next = [];
    for await (const batch of terminalTranscriptBatches(source, "codex", 1, cursor)) next.push(batch);
    assert.equal(next.flatMap(b => b.events).length, 1);
    assert.equal(next[0].events[0].body.blocks[0].text, "Respuesta");
    for await (const batch of terminalTranscriptBatches(source, "codex", 1, next.at(-1).cursor)) assert.deepEqual(batch.events, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the bridge imports the selected shared terminal and retains its history cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-terminal-"));
  const transcriptPath = join(dir, "session.jsonl");
  try {
    await writeFile(transcriptPath, JSON.stringify(message("user", "Ya estaba en Orca")) + "\n");
    const events = [], errors = [], state = {};
    const tick = createWorkBridge({
      config: {}, state, save: async () => {},
      call: async (_client, method, args) => {
        if (method === "work_inbox") return {
          sessions: [{ session: { id: "session", generation: 1, state: "idle", worktree: "path:/repo/work" }, thread: { repository: "id:repo" }, bot: { mode: "session", provider: "codex", runtimeHandle: "term_one" } }], turns: [], actions: [],
        };
        assert.equal(method, "work_sync");
        if (args.error) errors.push(args.error);
        events.push(...args.events);
      },
      runtimeLoader: async () => ({ call: async (method, args) => {
        assert.equal(method, "session.tabs.list");
        assert.equal(args.worktree, "path:/repo/work");
        return { tabs: [{ type: "terminal", terminal: "term_one", agentStatus: { state: "idle", providerSession: { id: "native", transcriptPath } } }] };
      } }),
    });
    const catalog = { repositories: [{ id: "id:repo" }], worktrees: [{ repository: "id:repo", worktree: "path:/repo/work" }], sessions: [{ worktree: "path:/repo/work", runtimeHandle: "term_one" }] };
    await tick({}, catalog);
    await tick({}, catalog);
    await tick({}, { ...catalog, worktrees: [] });
    assert.equal(events.length, 1);
    assert.equal(events[0].body.blocks[0].text, "Ya estaba en Orca");
    assert.match(errors[0], /ya no está compartido/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a closed terminal resolves only its own unambiguous saved conversation", () => {
  const terminal = { worktreePath: "/repo/work", title: "Actualizar React | work", executionHostId: "local" };
  const session = { cwd: "/repo/work", title: "Actualizar React", agent: "codex", sessionId: "saved", filePath: "/saved.jsonl", executionHostId: "local" };
  const sessions = [session, { ...session, cwd: "/private" }, { ...session, title: "Otra conversación" }, { ...session, subagent: {} }];
  assert.deepEqual(archivedTerminalSource(sessions, terminal, "codex", "path:/repo/work"), { id: "saved", transcriptPath: "/saved.jsonl" });
  assert.throws(() => archivedTerminalSource([...sessions, { ...session, sessionId: "other" }], terminal, "codex", "path:/repo/work"), /no ha podido identificar/);
  assert.throws(() => archivedTerminalSource(sessions, terminal, "codex", "path:/private"), /no pertenece/);
});
