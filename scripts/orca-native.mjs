import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { realpath, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const exec = promisify(execFile);
function canonical(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function mutation(
  method,
  sessionId,
  fence,
  fields,
  operationId = `${Date.now()}-${randomUUID().replaceAll("-", "")}`,
) {
  return {
    envelope: {
      sessionId,
      clientOperationId: operationId,
      expectedRuntimeFence: fence,
      payloadFingerprint: createHash("sha256")
        .update(canonical({ method, sessionId, fields }))
        .digest("hex"),
    },
    ...fields,
  };
}

/** Use the installed runtime's transport (local socket/pairing and source fence).
 * No reading provider transcripts, credentials, SQLite stores or private ports. */
export async function loadNativeRuntime() {
  let entry = process.env.SLAK_ORCA_RUNTIME;
  if (!entry) {
    const bin =
      process.env.SLAK_ORCA_BIN ||
      (await exec("which", ["orca"])).stdout.trim();
    const executable = await realpath(bin);
    const candidates = [
      resolve(
        dirname(executable),
        "../app.asar.unpacked/out/cli/runtime/client.js",
      ),
      resolve(dirname(executable), "../out/cli/runtime/client.js"),
      resolve(dirname(executable), "runtime/client.js"),
    ];
    for (const candidate of candidates)
      if (
        await access(candidate).then(
          () => true,
          () => false,
        )
      ) {
        entry = candidate;
        break;
      }
  }
  if (!entry)
    throw new Error(
      "No se encuentra el runtime nativo de Orca. Configura SLAK_ORCA_RUNTIME con la ruta a out/cli/runtime/client.js de tu instalación.",
    );
  const { RuntimeClient } = require(entry);
  const client = new RuntimeClient(undefined, 45_000);
  const status = await client.getCliStatus();
  if (
    !status.result.runtime.capabilities?.includes("agent-session.structured.v1")
  )
    throw new Error(
      "Actualiza Orca: esta versión no anuncia conversaciones nativas.",
    );
  return {
    async call(method, params) {
      const response = await client.call(
        method,
        params,
        method === "agentSession.conversationCommand"
          ? { timeoutMs: 205000 }
          : undefined,
      );
      const result = response.result;
      if (result?.ok === false)
        throw new Error(
          `Orca: ${JSON.stringify(result.refusal ?? result).slice(0, 1500)}`,
        );
      return result;
    },
  };
}

const visibleKinds = new Set([
  "message",
  "tool-call",
  "diff",
  "approval",
  "question",
  "status",
  "turn",
]);
// Provider frames can contain internal configuration. Publish only the render model.
function clean(value, depth = 0) {
  if (depth > 12) return "[contenido anidado omitido]";
  if (typeof value === "string")
    return value.length > 24000
      ? `${value.slice(0, 24000)}\n[… truncado]`
      : value;
  if (Array.isArray(value))
    return value.slice(0, 100).map((v) => clean(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !["providerFrame", "providerHandle", "accountHome"].includes(k),
        )
        .slice(0, 80)
        .map(([k, v]) => [k, clean(v, depth + 1)]),
    );
  return value;
}
export function publicEvents(items, generation) {
  return items
    .filter(
      (i) =>
        visibleKinds.has(i.body?.kind) &&
        !(i.body.kind === "message" && i.body.role === "user") &&
        !(
          i.body.kind === "status" &&
          i.body.providerFrame &&
          !["error", "warning"].includes(i.body.tone)
        ),
    )
    .map((i) => {
      let body = clean(i.body);
      if (body.kind === "message") {
        if (i.turnScope?.turnItemId)
          body.turnId = `${generation}:${i.turnScope.turnItemId}`;
        if (i.agentId) body.agentId = i.agentId;
      }
      if (JSON.stringify(body).length > 95000)
        body = {
          kind: "status",
          text: "Evento demasiado grande para la vista. Consulta el detalle en Orca.",
        };
      return {
        itemId: `${generation}:${i.itemId}`,
        revision: i.revision,
        sequence: i.sequence,
        observedAt: new Date(i.observedAt).toISOString(),
        body,
      };
    });
}
export function contextUsage(items) {
  const usage = items
    .filter((i) => i.body?.kind === "turn" && i.body.contextUsage)
    .at(-1)?.body.contextUsage;
  if (!usage) return {};
  const used = usage.used;
  const tokens =
    used?.kind === "report"
      ? used.usedTokens
      : used?.kind === "estimate"
        ? used.usage.inputTokens +
          used.usage.cacheCreationInputTokens +
          used.usage.cacheReadInputTokens
        : undefined;
  const window =
    usage.window?.tokens ??
    (used?.kind === "report" ? used.windowTokens : undefined);
  return { ...(tokens !== undefined && { tokens }), ...(window && { window }) };
}
export function turnCompletion(page, submissionId) {
  const submission = page.submissions?.find(
    (s) => s.clientMessageId === submissionId,
  );
  if (submission?.dispatchState === "rejected")
    return {
      status: "failed",
      result: submission.reason || "Orca rechazó el mensaje.",
    };
  const turnId = submission?.answeredInTurn?.turnItemId;
  const turn = page.items.find(
    (i) =>
      i.itemId === turnId ||
      (submission &&
        i.body.kind === "turn" &&
        (i.body.userItemId === `orca:${submissionId}` ||
          i.body.userItemId === submission.providerItemId)),
  );
  if (
    !turn ||
    !["completed", "interrupted", "unverifiable"].includes(turn.body.state)
  )
    return null;
  const parts = page.items
    .filter(
      (i) =>
        i.turnScope?.turnItemId === turn.itemId &&
        !i.agentId &&
        i.body.kind === "message" &&
        i.body.role === "assistant",
    )
    .map((i) =>
      i.body.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
    )
    .filter(Boolean);
  const status =
    turn.body.state === "completed" &&
    !["failed", "error"].includes(turn.body.outcome)
      ? "completed"
      : turn.body.state === "interrupted"
        ? "cancelled"
        : "failed";
  return {
    status,
    result:
      parts.at(-1)?.slice(-32000) ||
      (status === "completed"
        ? "Turno completado."
        : "El turno terminó sin una respuesta confirmada."),
  };
}
