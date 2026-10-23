import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channelMembers,
  machines,
  users,
  workActions,
  workEvents,
  workSessions,
  workThreads,
  workTurns,
} from "@/db/schema";
import { hashToken } from "@/lib/agents";
import {
  claimWorkTurn,
  finishWorkTurn,
  saveWorkMemory,
  worktreeSessionIds,
} from "@/lib/work";

const id = z.string().min(1).max(200);
const output = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
export type WorkPrincipal = { machineId: string } | { sessionId: string };

export function registerWorkTools(server: McpServer, principal: WorkPrincipal) {
  const machineId = "machineId" in principal ? principal.machineId : null;
  async function scope(sessionId: string) {
    const [row] = await db
      .select({
        session: workSessions,
        thread: workThreads,
        bot: agents,
        machine: machines,
      })
      .from(workSessions)
      .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
      .innerJoin(agents, eq(agents.id, workThreads.agentId))
      .innerJoin(machines, eq(machines.id, agents.machineId))
      .innerJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, workThreads.channelId),
          eq(channelMembers.userId, agents.id),
        ),
      )
      .where(eq(workSessions.id, sessionId));
    if (
      !row ||
      !row.machine.tokenHash ||
      (machineId
        ? row.machine.id !== machineId
        : sessionId !== (principal as { sessionId: string }).sessionId)
    )
      throw new Error("Conversación no autorizada.");
    if (!row.machine.repositories.some((r) => r.id === row.thread.repository))
      throw new Error("El proyecto ya no está compartido.");
    return row;
  }

  server.registerTool(
    "work_context",
    {
      description:
        "Objetivo, memoria versionada y conversaciones de este hilo. No incluye otros canales.",
      inputSchema: { sessionId: id },
    },
    async ({ sessionId }) => {
      const { session, thread } = await scope(sessionId);
      const turns = await db
        .select({
          id: workTurns.id,
          prompt: workTurns.prompt,
          result: workTurns.result,
          kind: workTurns.kind,
          status: workTurns.status,
          author: users.name,
        })
        .from(workTurns)
        .innerJoin(users, eq(users.id, workTurns.userId))
        .where(eq(workTurns.sessionId, sessionId))
        .orderBy(desc(workTurns.createdAt))
        .limit(12);
      const siblings = await db
        .select({
          id: workSessions.id,
          name: workSessions.name,
          role: workSessions.role,
          state: workSessions.state,
        })
        .from(workSessions)
        .where(eq(workSessions.threadId, thread.id));
      return output({
        objective: thread.objective,
        worktree:
          session.role === "worker"
            ? (session.worktree ?? thread.worktree)
            : thread.worktree,
        memory: session.memory,
        memoryVersion: session.memoryVersion,
        sessions: siblings,
        turns: turns.reverse(),
      });
    },
  );
  server.registerTool(
    "work_remember",
    {
      description:
        "Guarda una memoria de trabajo: decisiones, restricciones, plan, progreso, artefactos y preguntas. Usa la versión leída en work_context; se conserva al compactar o reemplazar sesión.",
      inputSchema: {
        sessionId: id,
        memory: z.string().max(24000),
        version: z.number().int().nonnegative(),
      },
    },
    async ({ sessionId, memory, version }) => {
      await scope(sessionId);
      return output(await saveWorkMemory(sessionId, memory, version));
    },
  );
  server.registerTool(
    "work_history",
    {
      description:
        "Recupera mensajes anteriores de esta conversación sin cargar todo el historial en contexto.",
      inputSchema: { sessionId: id, before: z.string().datetime().optional() },
    },
    async ({ sessionId, before }) => {
      await scope(sessionId);
      const turns = await db
        .select()
        .from(workTurns)
        .where(
          and(
            eq(workTurns.sessionId, sessionId),
            before ? sql`${workTurns.createdAt} < ${before}` : undefined,
          ),
        )
        .orderBy(desc(workTurns.createdAt))
        .limit(30);
      return output({ turns: turns.reverse(), before: turns[0]?.createdAt });
    },
  );
  if (!machineId) return;

  server.registerTool(
    "work_inbox",
    {
      description:
        "Sesiones nativas asignadas a esta máquina; incluye cola y operaciones persistentes.",
      inputSchema: {
        capabilities: z.array(z.string().max(100)).max(30).default([]),
      },
    },
    async ({ capabilities }) => {
      const rows = await db
        .select({
          session: workSessions,
          thread: workThreads,
          bot: {
            id: agents.id,
            mode: agents.mode,
            handle: agents.handle,
            runtimeHandle: agents.runtimeHandle,
            provider: agents.provider,
            state: agents.state,
            description: agents.description,
          },
        })
        .from(workSessions)
        .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
        .innerJoin(agents, eq(agents.id, workThreads.agentId))
        .innerJoin(
          channelMembers,
          and(
            eq(channelMembers.channelId, workThreads.channelId),
            eq(channelMembers.userId, agents.id),
          ),
        )
        .where(eq(agents.machineId, machineId))
        .orderBy(asc(workSessions.createdAt));
      const ids = rows.map((r) => r.session.id);
      const turns = ids.length
        ? await db
            .select()
            .from(workTurns)
            .where(
              and(
                inArray(workTurns.sessionId, ids),
                inArray(workTurns.status, ["queued", "running"]),
                sql`not exists (select 1 from agent_tasks legacy where legacy.id = ${workTurns.id})`,
              ),
            )
            .orderBy(asc(workTurns.createdAt), asc(workTurns.id))
        : [];
      const actions = ids.length
        ? await db
            .select()
            .from(workActions)
            .where(
              and(
                inArray(workActions.sessionId, ids),
                inArray(workActions.status, ["queued", "running"]),
              ),
            )
            .orderBy(asc(workActions.createdAt))
        : [];
      return output({
        sessions: rows.map(({ session, ...rest }) => ({
          ...rest,
          session: { ...session, tokenHash: undefined },
        })),
        turns,
        actions: actions.filter(
          (action) =>
            (action.kind !== "close-worktree" ||
              capabilities.includes("worktree-close.v1")) &&
            (action.kind !== "interrupt" ||
              capabilities.includes("session-interrupt.v1")),
        ),
      });
    },
  );
  server.registerTool(
    "work_claim",
    {
      description:
        "Recoge el siguiente mensaje; exclusión mutua por sesión y orden FIFO.",
      inputSchema: { sessionId: id, turnId: id },
    },
    async ({ sessionId, turnId }) => {
      const { bot } = await scope(sessionId);
      if (bot.state !== "ready") throw new Error("El bot está detenido.");
      return output(await claimWorkTurn(sessionId, turnId));
    },
  );
  server.registerTool(
    "work_bind",
    {
      description:
        "Vincula una sesión nativa a la conversación y registra su credencial MCP limitada a ese contexto.",
      inputSchema: {
        sessionId: id,
        generation: z.number().int().positive(),
        runtimeId: id,
        token: z.string().regex(/^slak_[a-f0-9]{64}$/),
        worktree: z.string().min(1).max(1000).optional(),
      },
    },
    async ({ sessionId, generation, runtimeId, token, worktree }) => {
      const { session } = await scope(sessionId);
      if (
        session.closedAt ||
        session.generation !== generation ||
        (session.runtimeId && session.runtimeId !== runtimeId)
      )
        throw new Error("La sesión cambió.");
      await db
        .update(workSessions)
        .set({
          runtimeId,
          tokenHash: hashToken(token),
          error: null,
          ...(worktree && { worktree }),
        })
        .where(eq(workSessions.id, sessionId));
      return output({ ok: true });
    },
  );
  server.registerTool(
    "work_sync",
    {
      description:
        "Sincroniza eventos reales del harness. Idempotente por item/revisión; nunca mezcla generaciones.",
      inputSchema: {
        sessionId: id,
        generation: z.number().int().positive(),
        state: z.enum(["idle", "running", "waiting", "stopped", "error"]),
        error: z.string().max(2000).nullable().optional(),
        context: z
          .object({
            tokens: z.number().nonnegative().optional(),
            window: z.number().positive().optional(),
            compactedAt: z.string().optional(),
          })
          .optional(),
        events: z
          .array(
            z.object({
              itemId: z.string().min(1).max(4096),
              revision: z.number().int().nonnegative(),
              sequence: z.number().int().nonnegative(),
              body: z
                .record(z.string(), z.unknown())
                .refine((b) => JSON.stringify(b).length <= 100000),
              observedAt: z.string().datetime(),
            }),
          )
          .max(200),
        removedItemIds: z.array(z.string().max(4096)).max(200).default([]),
      },
    },
    async ({
      sessionId,
      generation,
      state,
      error,
      context,
      events,
      removedItemIds,
    }) => {
      await scope(sessionId);
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(workSessions)
          .where(eq(workSessions.id, sessionId))
          .for("update");
        if (current.closedAt || current.generation !== generation)
          throw new Error("Generación obsoleta.");
        await tx
          .update(workSessions)
          .set({
            state,
            lastSeenAt: new Date(),
            ...(error !== undefined && { error }),
            ...(context && { context: { ...current.context, ...context } }),
          })
          .where(eq(workSessions.id, sessionId));
        if (events.length)
          await tx
            .insert(workEvents)
            .values(
              [
                ...new Map(
                  events.map((event) => [event.itemId, event]),
                ).values(),
              ].map((event) => ({
                ...event,
                sessionId,
                observedAt: new Date(event.observedAt),
              })),
            )
            .onConflictDoUpdate({
              target: [workEvents.sessionId, workEvents.itemId],
              set: {
                revision: sql`excluded.revision`,
                body: sql`excluded.body`,
              },
              // Enrich existing messages from older bridges without replacing a newer revision.
              setWhere: sql`${workEvents.revision} < excluded.revision OR (
                ${workEvents.revision} = excluded.revision AND (
                  (excluded.body->>'turnId' IS NOT NULL AND ${workEvents.body}->>'turnId' IS NULL)
                  OR (excluded.body->>'slakTurnId' IS NOT NULL AND ${workEvents.body}->>'slakTurnId' IS NULL)
                )
              )`,
            });
        if (removedItemIds.length)
          await tx
            .delete(workEvents)
            .where(
              and(
                eq(workEvents.sessionId, sessionId),
                inArray(workEvents.itemId, removedItemIds),
              ),
            );
      });
      return output({ ok: true });
    },
  );
  server.registerTool(
    "work_finish",
    {
      description:
        "Completa una entrega una sola vez y notifica al orquestador si procede.",
      inputSchema: {
        sessionId: id,
        turnId: id,
        result: z.string().max(32000),
        status: z.enum(["completed", "failed", "cancelled"]),
      },
    },
    async ({ sessionId, turnId, result, status }) => {
      await scope(sessionId);
      const turn = await db.query.workTurns.findFirst({
        where: and(
          eq(workTurns.id, turnId),
          eq(workTurns.sessionId, sessionId),
        ),
      });
      if (!turn) throw new Error("Turno no autorizado.");
      return output(await finishWorkTurn(turnId, result, status));
    },
  );
  server.registerTool(
    "work_action",
    {
      description: "Recoge o resuelve una operación de sesión.",
      inputSchema: {
        sessionId: id,
        actionId: id,
        phase: z.enum(["claim", "complete", "fail"]),
        error: z.string().max(2000).optional(),
        worktree: z.string().max(1000).optional(),
      },
    },
    async ({ sessionId, actionId, phase, error, worktree }) => {
      const { thread } = await scope(sessionId);
      await db.transaction(async (tx) => {
        const [action] = await tx
          .select()
          .from(workActions)
          .where(
            and(
              eq(workActions.id, actionId),
              eq(workActions.sessionId, sessionId),
            ),
          )
          .for("update");
        if (!action) throw new Error("Operación no autorizada.");
        if (["completed", "failed"].includes(action.status)) return;
        if (phase === "claim" && action.status !== "queued")
          throw new Error("Operación ya recogida.");
        if (phase !== "claim" && action.status !== "running")
          throw new Error("Operación no recogida.");
        await tx
          .update(workActions)
          .set({
            status:
              phase === "claim"
                ? "running"
                : phase === "complete"
                  ? "completed"
                  : "failed",
            error: error ?? null,
          })
          .where(eq(workActions.id, actionId));
        if (phase === "complete") {
          if (action.kind === "close-worktree") {
            const ids = await worktreeSessionIds(tx, sessionId);
            await tx
              .update(workSessions)
              .set({
                closedAt: new Date(),
                state: "stopped",
                tokenHash: null,
                error: null,
              })
              .where(inArray(workSessions.id, ids));
            await tx
              .update(workTurns)
              .set({
                status: "cancelled",
                result: "Worktree cerrado por el equipo.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  inArray(workTurns.sessionId, ids),
                  inArray(workTurns.status, ["queued", "running"]),
                ),
              );
            const terminalAgents = await tx
              .select({ id: agents.id })
              .from(agents)
              .where(
                and(
                  eq(agents.machineId, machineId!),
                  eq(agents.worktree, String(action.payload.worktree)),
                  eq(agents.mode, "session"),
                ),
              );
            if (terminalAgents.length) {
              const agentIds = terminalAgents.map((agent) => agent.id);
              await tx
                .update(agents)
                .set({ state: "stopped" })
                .where(inArray(agents.id, agentIds));
              await tx
                .update(agentTasks)
                .set({
                  status: "failed",
                  result: "Worktree cerrado por el equipo.",
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    inArray(agentTasks.agentId, agentIds),
                    inArray(agentTasks.status, ["queued", "running"]),
                  ),
                );
            }
            await tx
              .update(workActions)
              .set({ status: "failed", error: "El worktree se ha cerrado." })
              .where(
                and(
                  inArray(workActions.sessionId, ids),
                  inArray(workActions.status, ["queued", "running"]),
                ),
              );
            await tx
              .update(machines)
              .set({
                worktrees: sql`(select coalesce(jsonb_agg(tree), '[]'::jsonb) from jsonb_array_elements(${machines.worktrees}) tree where tree->>'worktree' <> ${String(action.payload.worktree)})`,
                sessions: sql`(select coalesce(jsonb_agg(entry), '[]'::jsonb) from jsonb_array_elements(${machines.sessions}) entry where entry->>'worktree' <> ${String(action.payload.worktree)})`,
              })
              .where(eq(machines.id, machineId!));
          }
          if (action.kind === "workspace" && worktree)
            await tx
              .update(workThreads)
              .set({ worktree })
              .where(eq(workThreads.id, thread.id));
          if (action.kind === "interrupt") {
            await tx
              .update(workSessions)
              .set({ state: "idle", error: null })
              .where(eq(workSessions.id, sessionId));
            await tx
              .update(workTurns)
              .set({
                status: "cancelled",
                result: "Interrumpido por el equipo.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workTurns.sessionId, sessionId),
                  inArray(workTurns.status, ["queued", "running"]),
                ),
              );
          }
          if (action.kind === "stop") {
            await tx
              .update(workSessions)
              .set({ state: "stopped", tokenHash: null })
              .where(eq(workSessions.id, sessionId));
            await tx
              .update(workTurns)
              .set({
                status: "cancelled",
                result: "Detenido por el equipo.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workTurns.sessionId, sessionId),
                  inArray(workTurns.status, ["queued", "running"]),
                ),
              );
          }
          if (action.kind === "compact")
            await tx
              .update(workSessions)
              .set({
                context: sql`${workSessions.context} || ${JSON.stringify({ compactedAt: new Date().toISOString() })}::jsonb`,
              })
              .where(eq(workSessions.id, sessionId));
          if (action.kind === "rotate") {
            await tx
              .update(workTurns)
              .set({
                status: "cancelled",
                result: "La sesión se renovó desde la memoria.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workTurns.sessionId, sessionId),
                  eq(workTurns.status, "running"),
                ),
              );
            await tx
              .update(workSessions)
              .set({
                generation: sql`${workSessions.generation} + 1`,
                runtimeId: null,
                tokenHash: null,
                state: "idle",
                error: null,
                context: {},
              })
              .where(eq(workSessions.id, sessionId));
          }
        }
      });
      return output({ ok: true });
    },
  );
}
