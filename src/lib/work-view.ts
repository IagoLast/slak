import type { WorkEvent, WorkTurn } from "@/lib/client";

export type ConversationView = "answers" | "messages" | "activity";
export const conversationViews = [
  { value: "answers", label: "Solo respuestas" },
  { value: "messages", label: "Mensajes y avances" },
  { value: "activity", label: "Toda la actividad" },
] as const;

export function isConversationView(value: unknown): value is ConversationView {
  return conversationViews.some((view) => view.value === value);
}

export function visibleWorkEvents(events: WorkEvent[], view: ConversationView) {
  const finished = new Set(
    events
      .filter(
        (event) =>
          event.body.kind === "turn" &&
          ["completed", "interrupted", "unverifiable"].includes(
            String(event.body.state),
          ),
      )
      .map((event) => event.itemId),
  );
  const finalMessages = new Map<string, WorkEvent>();
  for (const event of events) {
    const body = event.body;
    if (
      body.kind !== "message" ||
      body.role === "user" ||
      body.agentId ||
      typeof body.turnId !== "string" ||
      !hasText(body)
    )
      continue;
    const current = finalMessages.get(body.turnId);
    if (!current || event.sequence > current.sequence)
      finalMessages.set(body.turnId, event);
  }
  return events.filter((event) => {
    const body = event.body;
    if (body.kind === "turn") return false;
    if (view === "activity") return true;
    if (body.kind === "approval" || body.kind === "question") return true;
    if (body.kind === "status")
      return ["warning", "error"].includes(String(body.tone));
    if (body.kind !== "message" || body.agentId || !hasText(body)) return false;
    if (body.role === "user") return true;
    if (view === "messages") return true;
    if (body.source === "orca-terminal" && body.phase === "commentary") return false;
    // Old events without turn metadata remain readable; do not guess which
    // text was a final response from timestamps or the message's wording.
    if (typeof body.turnId !== "string") return true;
    return (
      finished.has(body.turnId) &&
      finalMessages.get(body.turnId)?.itemId === event.itemId
    );
  });
}

function hasText(body: Record<string, unknown>) {
  return (
    Array.isArray(body.blocks) &&
    body.blocks.some(
      (block) =>
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim(),
    )
  );
}

export function visibleWorkTurns(turns: WorkTurn[], view: ConversationView) {
  return view === "activity"
    ? turns
    : turns.filter((turn) => turn.kind !== "notification");
}
