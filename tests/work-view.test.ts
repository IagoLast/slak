import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWorkEvents, visibleWorkTurns } from "../src/lib/work-view";
import type { WorkEvent, WorkTurn } from "../src/lib/client";

const event = (
  itemId: string,
  sequence: number,
  body: Record<string, unknown>,
): WorkEvent => ({
  itemId,
  sequence,
  body,
  revision: 1,
  sessionId: "session",
  observedAt: "2026-10-23T12:00:00Z",
});
const message = (itemId: string, sequence: number, text: string) =>
  event(itemId, sequence, {
    kind: "message",
    role: "assistant",
    turnId: "1:turn",
    blocks: [{ type: "text", text }],
  });
const events = [
  event("1:turn", 1, { kind: "turn", state: "completed" }),
  message("progress", 2, "Voy a comprobarlo"),
  event("tool", 3, { kind: "tool-call", name: "shell" }),
  event("question", 4, { kind: "question" }),
  event("approval", 5, { kind: "approval" }),
  event("error", 6, {
    kind: "status",
    tone: "error",
    text: "Fallo de conexión",
  }),
  event("status", 7, { kind: "status", tone: "info", text: "Executing" }),
  message("answer", 8, "La respuesta final"),
  event("child", 9, {
    ...message("child", 9, "Subagente").body,
    agentId: "child",
  }),
];

test("answers view shows the final response and all requests and errors", () => {
  assert.deepEqual(
    visibleWorkEvents(events, "answers").map((item) => item.itemId),
    ["question", "approval", "error", "answer"],
  );
});

test("ongoing turns do not mistake the latest progress update for a final response", () => {
  const running = events.map((item) =>
    item.itemId === "1:turn"
      ? { ...item, body: { kind: "turn", state: "running" } }
      : item,
  );
  assert.deepEqual(
    visibleWorkEvents(running, "answers").map((item) => item.itemId),
    ["question", "approval", "error"],
  );
});

test("message view retains progress and hides technical and child-agent events", () => {
  assert.deepEqual(
    visibleWorkEvents(events, "messages").map((item) => item.itemId),
    ["progress", "question", "approval", "error", "answer"],
  );
  assert.equal(visibleWorkEvents(events, "activity").length, events.length - 1);
});

test("response selection uses sequence rather than the order of paginated events", () => {
  assert.deepEqual(
    visibleWorkEvents([...events].reverse(), "answers")
      .filter((item) => item.body.kind === "message")
      .map((item) => item.itemId),
    ["answer"],
  );
});

test("old unclassified messages stay readable and empty message blocks do not create blank bubbles", () => {
  const legacy = event("old", 1, {
    kind: "message",
    blocks: [{ type: "text", text: "Existing answer" }],
  });
  const internal = event("internal", 2, {
    kind: "message",
    blocks: [{ type: "reasoning", text: "internal" }],
  });
  assert.deepEqual(visibleWorkEvents([legacy, internal], "answers"), [legacy]);
});

test("internal notifications are available only in the activity view", () => {
  const turns = ["human", "delegation", "notification"].map((kind) => ({
    kind,
  })) as WorkTurn[];
  assert.equal(visibleWorkTurns(turns, "answers").length, 2);
  assert.equal(visibleWorkTurns(turns, "activity").length, 3);
});
