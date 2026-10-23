import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archivedTerminalSource,
  terminalTranscriptBatches,
  transcriptMessage,
} from "../scripts/orca-transcript.mjs";
import { createWorkBridge } from "../scripts/orca-work.mjs";

const timestamp = "2026-10-23T14:00:00.000Z";
const message = (role, text) => ({
  timestamp,
  type: "response_item",
  payload: {
    type: "message",
    role,
    content: [{ type: role === "user" ? "input_text" : "output_text", text }],
  },
});

test("imports conversation text without internal instructions, tools or duplicate provider events", () => {
  assert.equal(
    transcriptMessage(message("user", "Hola"), "codex").body.blocks[0].text,
    "Hola",
  );
  assert.equal(
    transcriptMessage(message("developer", "Private instructions"), "codex"),
    null,
  );
  assert.equal(
    transcriptMessage(
      {
        timestamp,
        type: "event_msg",
        payload: { type: "agent_message", message: "Duplicate" },
      },
      "codex",
    ),
    null,
  );
  assert.equal(
    transcriptMessage(
      message("user", "<environment_context>private</environment_context>"),
      "codex",
    ),
    null,
  );
  assert.equal(
    transcriptMessage(
      {
        timestamp,
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Private" },
            { type: "text", text: "Respuesta" },
            { type: "tool_use", input: { secret: "hidden" } },
          ],
        },
      },
      "claude",
    ).body.blocks[0].text,
    "Respuesta",
  );
});

test("recovers old terminal messages and resumes after complete lines without duplicates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-history-"));
  const transcriptPath = join(dir, "session.jsonl");
  const source = { id: "provider-session", transcriptPath };
  const partial = JSON.stringify(message("assistant", "Respuesta"));
  try {
    await writeFile(
      transcriptPath,
      JSON.stringify(message("user", "Mensaje anterior")) +
        "\n" +
        partial.slice(0, 35),
    );
    const batches = [];
    for await (const batch of terminalTranscriptBatches(source, "codex", 1))
      batches.push(batch);
    assert.equal(batches.flatMap((b) => b.events).length, 1);
    const cursor = batches.at(-1).cursor;
    await appendFile(transcriptPath, partial.slice(35) + "\n");
    const next = [];
    for await (const batch of terminalTranscriptBatches(
      source,
      "codex",
      1,
      cursor,
    ))
      next.push(batch);
    assert.equal(next.flatMap((b) => b.events).length, 1);
    assert.equal(next[0].events[0].body.blocks[0].text, "Respuesta");
    for await (const batch of terminalTranscriptBatches(
      source,
      "codex",
      1,
      next.at(-1).cursor,
    ))
      assert.deepEqual(batch.events, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bridge imports the selected shared terminal and retains its history cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-terminal-"));
  const transcriptPath = join(dir, "session.jsonl");
  try {
    await writeFile(
      transcriptPath,
      JSON.stringify(message("user", "Ya estaba en Orca")) + "\n",
    );
    const events = [],
      errors = [],
      state = {};
    const tick = createWorkBridge({
      config: {},
      state,
      save: async () => {},
      call: async (_client, method, args) => {
        if (method === "work_inbox")
          return {
            sessions: [
              {
                session: {
                  id: "session",
                  generation: 1,
                  state: "idle",
                  worktree: "path:/repo/work",
                },
                thread: { repository: "id:repo" },
                bot: {
                  mode: "session",
                  provider: "codex",
                  runtimeHandle: "term_one",
                },
              },
            ],
            turns: [],
            actions: [],
          };
        assert.equal(method, "work_sync");
        if (args.error) errors.push(args.error);
        events.push(...args.events);
      },
      runtimeLoader: async () => ({
        call: async (method, args) => {
          assert.equal(method, "session.tabs.list");
          assert.equal(args.worktree, "path:/repo/work");
          return {
            tabs: [
              {
                type: "terminal",
                terminal: "term_one",
                agentStatus: {
                  state: "idle",
                  providerSession: { id: "native", transcriptPath },
                },
              },
            ],
          };
        },
      }),
    });
    const catalog = {
      repositories: [{ id: "id:repo" }],
      worktrees: [{ repository: "id:repo", worktree: "path:/repo/work" }],
      sessions: [{ worktree: "path:/repo/work", runtimeHandle: "term_one" }],
    };
    await tick({}, catalog);
    await tick({}, catalog);
    await tick({}, { ...catalog, worktrees: [] });
    assert.equal(events.length, 1);
    assert.equal(events[0].body.blocks[0].text, "Ya estaba en Orca");
    assert.match(errors[0], /ya no está compartido/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a closed terminal resolves only its own unambiguous saved conversation", () => {
  const terminal = {
    worktreePath: "/repo/work",
    title: "Actualizar React | work",
    executionHostId: "local",
  };
  const session = {
    cwd: "/repo/work",
    title: "Actualizar React",
    agent: "codex",
    sessionId: "saved",
    filePath: "/saved.jsonl",
    executionHostId: "local",
  };
  const sessions = [
    session,
    { ...session, cwd: "/private" },
    { ...session, title: "Otra conversación" },
    { ...session, subagent: {} },
  ];
  assert.deepEqual(
    archivedTerminalSource(sessions, terminal, "codex", "path:/repo/work"),
    { id: "saved", transcriptPath: "/saved.jsonl" },
  );
  assert.throws(
    () =>
      archivedTerminalSource(
        [...sessions, { ...session, sessionId: "other" }],
        terminal,
        "codex",
        "path:/repo/work",
      ),
    /no ha podido identificar/,
  );
  assert.throws(
    () => archivedTerminalSource(sessions, terminal, "codex", "path:/private"),
    /no pertenece/,
  );
});

test("terminal messages are sent verbatim once and finish from the real transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-direct-"));
  const transcriptPath = join(dir, "session.jsonl");
  const prompt = "Este es mi mensaje\ncon dos líneas";
  const session = {
    id: "chat",
    generation: 1,
    state: "idle",
    worktree: "path:/repo",
  };
  const turn = { id: "turn", sessionId: session.id, prompt, status: "queued" };
  let sends = 0,
    finished = false,
    phase = "done";
  const synced = [];
  try {
    await writeFile(transcriptPath, "");
    const tick = createWorkBridge({
      config: {},
      state: {},
      save: async () => {},
      call: async (_client, method, args) => {
        if (method === "work_inbox")
          return {
            sessions: [
              {
                session,
                thread: { repository: "id:repo" },
                bot: {
                  mode: "session",
                  provider: "codex",
                  runtimeHandle: "term_chat",
                },
              },
            ],
            turns: finished ? [] : [turn],
            actions: [],
          };
        if (method === "work_claim") {
          turn.status = "running";
          return {};
        }
        if (method === "work_finish") {
          assert.equal(args.result, "Respuesta de Orca");
          finished = true;
          return {};
        }
        assert.equal(method, "work_sync");
        assert.equal(args.error, null);
        synced.push(...args.events);
        return {};
      },
      runtimeLoader: async () => ({
        call: async (method, args) => {
          if (method === "session.tabs.list")
            return {
              tabs: [
                {
                  type: "terminal",
                  terminal: "term_chat",
                  incarnationId: "instance",
                  agentStatus: {
                    state: phase,
                    providerSession: { id: "native", transcriptPath },
                  },
                },
              ],
            };
          assert.equal(method, "terminal.send");
          assert.equal(args.text, prompt);
          assert.equal(args.expectedIncarnationId, "instance");
          sends++;
          const now = new Date(Date.now() + 1).toISOString();
          await appendFile(
            transcriptPath,
            JSON.stringify({
              ...message(
                "user",
                `<pasted_content id="1">${prompt}</pasted_content id="1">`,
              ),
              timestamp: now,
            }) + "\n",
          );
          phase = "working";
          return { accepted: true };
        },
      }),
    });
    const catalog = {
      repositories: [{ id: "id:repo" }],
      worktrees: [{ repository: "id:repo", worktree: "path:/repo" }],
      sessions: [],
    };
    await tick({}, catalog);
    await tick({}, catalog);
    assert.equal(finished, false);
    await appendFile(
      transcriptPath,
      JSON.stringify({
        ...message("assistant", "Respuesta de Orca"),
        timestamp: new Date(Date.now() + 2).toISOString(),
      }) + "\n",
    );
    phase = "done";
    await tick({}, catalog);
    assert.equal(sends, 1);
    assert.equal(finished, true);
    assert.equal(
      synced.find((e) => e.body.role === "user").body.slakTurnId,
      turn.id,
    );
    assert.equal(
      synced.find((e) => e.body.role === "assistant").body.slakTurnId,
      turn.id,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("old Claude paste envelopes from the bridge are removed during reimport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slak-paste-"));
  try {
    const transcriptPath = join(dir, "session.jsonl");
    await writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp,
        type: "user",
        message: {
          role: "user",
          content:
            '<pasted_content id="01da">Has recibido trabajo de tu equipo a través de Slak en esta sesión de Orca.\nPetición: Hola</pasted_content id="01da">',
        },
      }) + "\n",
    );
    const batches = [];
    for await (const batch of terminalTranscriptBatches(
      { id: "claude", transcriptPath },
      "claude",
      1,
    ))
      batches.push(batch);
    assert.equal(batches.flatMap((b) => b.events).length, 0);
    assert.equal(batches.flatMap((b) => b.removedItemIds).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
