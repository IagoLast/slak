import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mutation,
  publicEvents,
  contextUsage,
  turnCompletion,
} from "../scripts/orca-native.mjs";
import { workPrompt } from "../scripts/orca-work.mjs";

test("native completion requires evidence for this exact send, not an older finished turn", () => {
  const page = {
    submissions: [
      {
        clientMessageId: "send-1",
        dispatchState: "accepted",
        providerItemId: "provider-1",
      },
    ],
    items: [
      {
        itemId: "turn-1",
        body: {
          kind: "turn",
          userItemId: "orca:send-1",
          state: "completed",
          outcome: "success",
        },
      },
      {
        itemId: "answer",
        body: {
          kind: "message",
          role: "assistant",
          blocks: [{ type: "text", text: "Listo" }],
        },
        turnScope: { kind: "turn", turnItemId: "turn-1" },
      },
      {
        itemId: "child-answer",
        agentId: "child",
        body: {
          kind: "message",
          role: "assistant",
          blocks: [{ type: "text", text: "Privado del subagente" }],
        },
        turnScope: { kind: "turn", turnItemId: "turn-1" },
      },
    ],
  };
  assert.deepEqual(turnCompletion(page, "send-1"), {
    status: "completed",
    result: "Listo",
  });
  assert.equal(turnCompletion(page, "send-2"), null);
  page.items[0].body.state = "running";
  assert.equal(turnCompletion(page, "send-1"), null);
});

test("stream revisions and tool results survive projection; system prompt and raw provider frames do not", () => {
  const base = {
    itemId: "i",
    revision: 0,
    sequence: 4,
    observedAt: 1700000000000,
  };
  const events = publicEvents(
    [
      {
        ...base,
        body: {
          kind: "message",
          role: "user",
          blocks: [{ type: "text", text: "internal bootstrap" }],
        },
      },
      {
        ...base,
        itemId: "tool",
        body: {
          kind: "tool-call",
          name: "shell",
          state: "completed",
          input: { command: "pwd" },
          output: { head: "/workspace", truncated: false },
          providerFrame: { hidden: true },
        },
      },
    ],
    2,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].itemId, "2:tool");
  assert.equal(events[0].revision, 0);
  assert.equal(events[0].body.output.head, "/workspace");
  assert.equal(events[0].body.providerFrame, undefined);
});

test("native payload fingerprints are canonical and bind to method and session", () => {
  const a = mutation(
    "agentSession.send",
    "codex_one",
    1,
    { body: { text: "Hi", kind: "message" } },
    "op",
  );
  const b = mutation(
    "agentSession.send",
    "codex_one",
    1,
    { body: { kind: "message", text: "Hi" } },
    "op",
  );
  assert.equal(a.envelope.payloadFingerprint, b.envelope.payloadFingerprint);
  assert.notEqual(
    a.envelope.payloadFingerprint,
    mutation("agentSession.send", "codex_two", 1, b.body).envelope
      .payloadFingerprint,
  );
});

test("context percentage uses provider measurements and restored prompts include durable memory", () => {
  assert.deepEqual(
    contextUsage([
      {
        body: {
          kind: "turn",
          contextUsage: {
            used: { kind: "report", usedTokens: 80000, windowTokens: 100000 },
          },
        },
      },
    ]),
    { tokens: 80000, window: 100000 },
  );
  const prompt = workPrompt(
    {
      session: { role: "orchestrator" },
      bot: { handle: "iago-bot", description: "" },
    },
    { id: "turn", kind: "human", prompt: "Sigue" },
    {
      memoryVersion: 3,
      objective: "Feature",
      memory: "No romper la API",
      turns: [],
      sessions: [],
      worktree: "/wt",
    },
    "/tmp/session config.json",
  );
  assert.match(prompt, /No romper la API/);
  assert.match(prompt, /--version 3/);
  assert.match(prompt, /delegate/);
  assert.doesNotMatch(prompt, /slak_[a-f0-9]{64}/);
});
