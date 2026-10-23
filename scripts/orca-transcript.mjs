import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export function terminalMessageText(text) {
  return text
    .trim()
    .replace(
      /^<pasted_content\b[^>]*>\s*([\s\S]*?)\s*<\/pasted_content\b[^>]*>$/,
      "$1",
    )
    .trim();
}

export function correlateTerminalEvents(events, delivery) {
  if (!delivery) return events;
  return events.map((event) => {
    if (Date.parse(event.observedAt) < delivery.sentAt) return event;
    const text = event.body.blocks
      .map((block) => block.text || "")
      .join("\n\n");
    if (event.body.role === "user") {
      if (
        !delivery.userItemId &&
        terminalMessageText(text) === terminalMessageText(delivery.prompt)
      )
        delivery.userItemId = event.itemId;
      else if (delivery.userItemId && delivery.userItemId !== event.itemId)
        delivery.nextUserSeen = true;
    }
    if (event.itemId === delivery.userItemId)
      return { ...event, body: { ...event.body, slakTurnId: delivery.id } };
    if (
      delivery.userItemId &&
      !delivery.nextUserSeen &&
      event.body.role === "assistant"
    ) {
      delivery.result = text;
      return { ...event, body: { ...event.body, slakTurnId: delivery.id } };
    }
    return event;
  });
}

function isBridgePrompt(text) {
  return terminalMessageText(text).startsWith(
    "Has recibido trabajo de tu equipo a través de Slak",
  );
}

function transcriptRecordMessage(record, provider) {
  return provider === "codex"
    ? record.type === "response_item" && record.payload?.type === "message"
      ? record.payload
      : null
    : ["user", "assistant"].includes(record.type) && !record.isSidechain
      ? record.message
      : null;
}

function messageText(message) {
  return typeof message?.content === "string"
    ? message.content
    : (message?.content ?? [])
        .filter((part) =>
          ["text", "input_text", "output_text"].includes(part.type),
        )
        .map((part) => part.text || "")
        .join("\n\n");
}

export function archivedTerminalSource(sessions, terminal, provider, worktree) {
  const path = worktree.replace(/^path:/, "");
  if (
    terminal.worktreePath !== path ||
    (terminal.executionHostId && terminal.executionHostId !== "local")
  )
    throw new Error("El terminal ya no pertenece a este worktree local.");
  const title = terminal.title?.split(" | ")[0].trim();
  const matches = title
    ? sessions.filter(
        (session) =>
          session.cwd === path &&
          session.agent === provider &&
          (!session.executionHostId || session.executionHostId === "local") &&
          !session.subagent &&
          session.title === title,
      )
    : [];
  if (matches.length !== 1 || !matches[0].sessionId || !matches[0].filePath)
    throw new Error(
      "La sesión está cerrada y Orca no ha podido identificar su historial guardado.",
    );
  return { id: matches[0].sessionId, transcriptPath: matches[0].filePath };
}

// Only conversation text leaves the machine. Provider metadata, reasoning,
// system instructions, tool calls and tool results are never published.
export function transcriptMessage(record, provider) {
  const message = transcriptRecordMessage(record, provider);
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  if (["analysis", "summary"].includes(message.channel || message.phase))
    return null;
  const text = terminalMessageText(messageText(message));
  if (!text.trim()) return null;
  if (
    message.role === "user" &&
    (/^(<environment_context>|# AGENTS\.md instructions|<local-command|<command-name|<system-reminder>)/.test(
      text.trim(),
    ) ||
      isBridgePrompt(text))
  )
    return null;
  if (!record.timestamp || !Number.isFinite(Date.parse(record.timestamp)))
    return null;
  return {
    body: {
      kind: "message",
      role: message.role,
      source: "orca-terminal",
      ...(message.phase && { phase: message.phase }),
      blocks: [{ type: "text", text: text.slice(0, 24000) }],
    },
    observedAt: new Date(record.timestamp).toISOString(),
  };
}

/** Read only the transcript identified by Orca for the selected shared terminal.
 * Persist byte offsets after uploads; an incomplete final line is retried later. */
export async function* terminalTranscriptBatches(
  providerSession,
  provider,
  generation,
  cursor = {},
) {
  const file = await open(providerSession.transcriptPath, "r");
  try {
    const stat = await file.stat();
    const source = createHash("sha256")
      .update(`${providerSession.id}:${stat.dev}:${stat.ino}`)
      .digest("hex")
      .slice(0, 24);
    let offset =
      cursor.source === source && cursor.offset <= stat.size
        ? cursor.offset
        : 0;
    let pending = Buffer.alloc(0),
      events = [],
      removedItemIds = [],
      bytes = 0;
    if (offset < stat.size) {
      const stream = file.createReadStream({
        start: offset,
        end: stat.size - 1,
        autoClose: false,
      });
      for await (const chunk of stream) {
        pending = Buffer.concat([pending, chunk]);
        let newline;
        while ((newline = pending.indexOf(10)) !== -1) {
          const position = offset;
          const line = pending.subarray(0, newline).toString("utf8");
          offset += newline + 1;
          pending = pending.subarray(newline + 1);
          let record;
          try {
            record = JSON.parse(line);
          } catch {
            continue;
          }
          const itemId = `${generation}:terminal:${source}:${position}`;
          const raw = transcriptRecordMessage(record, provider);
          if (raw?.role === "user" && isBridgePrompt(messageText(raw)))
            removedItemIds.push(itemId);
          const message = transcriptMessage(record, provider);
          if (!message) continue;
          const event = {
            itemId,
            revision: 2,
            sequence: position,
            ...message,
          };
          events.push(event);
          bytes += Buffer.byteLength(JSON.stringify(event));
          if (events.length >= 100 || bytes >= 600000) {
            yield { events, removedItemIds, cursor: { source, offset } };
            events = [];
            removedItemIds = [];
            bytes = 0;
          }
        }
      }
    }
    yield { events, removedItemIds, cursor: { source, offset } };
  } finally {
    await file.close();
  }
}
