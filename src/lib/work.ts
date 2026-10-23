import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  agents,
  machines,
  messages,
  workActions,
  workSessions,
  workThreads,
  workTurns,
} from "@/db/schema";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function worktreeSessionIds(tx: Transaction, sessionId: string) {
  const [target] = await tx
    .select({
      machineId: agents.machineId,
      worktree: sql<
        string | null
      >`coalesce(${workSessions.worktree}, case when ${workSessions.role} = 'orchestrator' then ${workThreads.worktree} end)`,
    })
    .from(workSessions)
    .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
    .innerJoin(agents, eq(agents.id, workThreads.agentId))
    .where(eq(workSessions.id, sessionId));
  if (!target?.machineId || !target.worktree) return [sessionId];
  const rows = await tx
    .select({ id: workSessions.id })
    .from(workSessions)
    .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
    .innerJoin(agents, eq(agents.id, workThreads.agentId))
    .where(
      and(
        eq(agents.machineId, target.machineId),
        sql`coalesce(${workSessions.worktree}, case when ${workSessions.role} = 'orchestrator' then ${workThreads.worktree} end) = ${target.worktree}`,
      ),
    );
  return rows.map((row) => row.id);
}

export async function assertWorktreeNotClosing(
  tx: Transaction,
  sessionId: string,
) {
  const ids = await worktreeSessionIds(tx, sessionId);
  const [closing] = await tx
    .select({ id: workActions.id })
    .from(workActions)
    .where(
      and(
        inArray(workActions.sessionId, ids),
        eq(workActions.kind, "close-worktree"),
        inArray(workActions.status, ["queued", "running"]),
      ),
    );
  if (closing)
    throw new Error(
      "Este worktree se está cerrando. Espera a que termine la operación.",
    );
}

export async function finishWorkTurn(
  turnId: string,
  result: string,
  status: "completed" | "failed" | "cancelled",
) {
  return db.transaction(async (tx) => {
    const [turn] = await tx
      .update(workTurns)
      .set({ status, result, updatedAt: new Date() })
      .where(and(eq(workTurns.id, turnId), eq(workTurns.status, "running")))
      .returning();
    if (!turn) return { replayed: true };
    const [session] = await tx
      .select()
      .from(workSessions)
      .where(eq(workSessions.id, turn.sessionId));
    const [thread] = await tx
      .select()
      .from(workThreads)
      .where(eq(workThreads.id, session.threadId));
    await tx
      .update(workSessions)
      .set({
        state: status === "failed" ? "error" : "idle",
        error: status === "failed" ? result : null,
      })
      .where(eq(workSessions.id, session.id));
    if (session.role === "orchestrator" && result) {
      await tx.insert(messages).values({
        id: nanoid(),
        channelId: thread.channelId,
        parentId: thread.rootMessageId,
        userId: thread.agentId,
        content: result,
      });
    }
    return { replayed: false };
  });
}

export async function queueWorkAction(
  sessionId: string,
  kind: typeof workActions.$inferInsert.kind,
  payload: Record<string, unknown> = {},
) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(workSessions)
      .where(eq(workSessions.id, sessionId))
      .for("update");
    if (!session) throw new Error("Conversación no encontrada.");
    if (session.closedAt) throw new Error("Este worktree está cerrado.");
    if (kind === "close-worktree") {
      // One close per machine/worktree, including conversations in other channels.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["close-worktree", payload.worktree])}, 0))`,
      );
      const [target] = await tx
        .select({ machine: machines })
        .from(machines)
        .innerJoin(agents, eq(agents.machineId, machines.id))
        .innerJoin(workThreads, eq(workThreads.agentId, agents.id))
        .where(eq(workThreads.id, session.threadId));
      const tree = target?.machine.worktrees.find(
        (tree) => tree.worktree === payload.worktree,
      );
      if (!target?.machine.capabilities.includes("worktree-close.v1"))
        throw new Error(
          "Actualiza y reinicia el puente de Orca para cerrar worktrees desde Slak.",
        );
      if (!tree || !target.machine.tokenHash)
        throw new Error("El worktree ya no está compartido.");
      if (
        !target.machine.lastSeenAt ||
        target.machine.lastSeenAt.getTime() < Date.now() - 60_000
      )
        throw new Error("Conecta la máquina antes de cerrar el worktree.");
      payload = { worktree: tree.worktree, identity: tree.identity };
    }
    if (kind === "interrupt") {
      const [target] = await tx
        .select({ machine: machines })
        .from(machines)
        .innerJoin(agents, eq(agents.machineId, machines.id))
        .innerJoin(workThreads, eq(workThreads.agentId, agents.id))
        .where(eq(workThreads.id, session.threadId));
      if (!target?.machine.capabilities.includes("session-interrupt.v1"))
        throw new Error(
          "Actualiza y reinicia el puente de Orca para interrumpir sesiones.",
        );
      if (
        !target.machine.tokenHash ||
        !target.machine.lastSeenAt ||
        target.machine.lastSeenAt.getTime() < Date.now() - 60_000
      )
        throw new Error("Conecta la máquina antes de interrumpir el turno.");
      if (session.state === "stopped")
        throw new Error("Esta sesión está detenida.");
    }
    await assertWorktreeNotClosing(tx, sessionId);
    const [pending] = await tx
      .select()
      .from(workActions)
      .where(
        and(
          eq(workActions.sessionId, sessionId),
          inArray(workActions.status, ["queued", "running"]),
        ),
      );
    if (pending)
      throw new Error("Ya hay una operación pendiente en esta conversación.");
    if (
      (kind === "compact" || kind === "rotate") &&
      ["running", "waiting"].includes(session.state)
    )
      throw new Error("Espera a que termine el turno o detenlo primero.");
    const id = nanoid();
    await tx.insert(workActions).values({ id, sessionId, kind, payload });
    return { id };
  });
}

export async function claimWorkTurn(sessionId: string, turnId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(workSessions)
      .where(eq(workSessions.id, sessionId))
      .for("update");
    if (!session || session.closedAt || session.state === "stopped")
      throw new Error("Conversación detenida.");
    await assertWorktreeNotClosing(tx, sessionId);
    const [first] = await tx
      .select()
      .from(workTurns)
      .where(
        and(
          eq(workTurns.sessionId, sessionId),
          inArray(workTurns.status, ["queued", "running"]),
        ),
      )
      .orderBy(asc(workTurns.createdAt), asc(workTurns.id))
      .limit(1);
    if (!first || first.id !== turnId || first.status !== "queued")
      throw new Error("Hay un turno anterior pendiente.");
    const [action] = await tx
      .select()
      .from(workActions)
      .where(
        and(
          eq(workActions.sessionId, sessionId),
          inArray(workActions.status, ["queued", "running"]),
        ),
      );
    if (action) throw new Error("Hay una operación pendiente.");
    await tx
      .update(workTurns)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(workTurns.id, turnId));
    await tx
      .update(workSessions)
      .set({ state: "running", error: null })
      .where(eq(workSessions.id, sessionId));
    return first;
  });
}

export async function saveWorkMemory(
  sessionId: string,
  memory: string,
  version: number,
) {
  const [row] = await db
    .update(workSessions)
    .set({ memory, memoryVersion: sql`${workSessions.memoryVersion} + 1` })
    .where(
      and(
        eq(workSessions.id, sessionId),
        eq(workSessions.memoryVersion, version),
      ),
    )
    .returning({ version: workSessions.memoryVersion });
  if (!row)
    throw new Error(
      "La memoria cambió. Lee la versión actual antes de guardar.",
    );
  return row;
}
