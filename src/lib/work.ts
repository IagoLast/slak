import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  agents,
  channels,
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

/** Call inside the transaction that inserts the source message. The root lock
 * serializes simultaneous replies, including the first mention in an old thread. */
export async function enqueueWork(
  tx: Transaction,
  input: {
    agentId: string;
    channelId: string;
    messageId: string;
    userId: string;
    prompt: string;
  },
) {
  const [source] = await tx
    .select()
    .from(messages)
    .where(eq(messages.id, input.messageId));
  const [channel] = await tx
    .select()
    .from(channels)
    .where(eq(channels.id, input.channelId));
  const rootId = source.parentId ?? source.id;
  if (channel.type === "dm")
    // Message inserts already hold a foreign-key lock on the channel. An
    // advisory lock serializes the parent without upgrading that shared lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["parent-dm", input.channelId, input.agentId])}, 0))`,
    );
  else
    await tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.id, rootId))
      .for("update");
  let [thread] = await tx
    .select()
    .from(workThreads)
    .where(
      and(
        channel.type === "dm"
          ? eq(workThreads.channelId, input.channelId)
          : eq(workThreads.rootMessageId, rootId),
        eq(workThreads.agentId, input.agentId),
      ),
    )
    .orderBy(asc(workThreads.createdAt))
    .limit(1);
  if (!thread) {
    const [bot] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, input.agentId));
    [thread] = await tx
      .insert(workThreads)
      .values({
        id: nanoid(),
        agentId: bot.id,
        channelId: input.channelId,
        rootMessageId: rootId,
        title:
          input.prompt
            .replace(/@[\w-]+/g, "")
            .trim()
            .slice(0, 100) || "Nueva conversación",
        objective: input.prompt,
        repository: bot.repository,
        createdBy: input.userId,
      })
      .returning();
    await tx.insert(workSessions).values({
      id: nanoid(),
      threadId: thread.id,
      name: "Orquestador",
      role: "orchestrator",
    });
  }
  const [session] = await tx
    .select()
    .from(workSessions)
    .where(
      and(
        eq(workSessions.threadId, thread.id),
        eq(workSessions.role, "orchestrator"),
      ),
    );
  await tx
    .insert(workTurns)
    .values({
      id: nanoid(),
      sessionId: session.id,
      messageId: input.messageId,
      userId: input.userId,
      prompt: input.prompt,
    })
    .onConflictDoNothing();
  return thread;
}

export async function delegateWork(
  parentId: string,
  name: string,
  prompt: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(workSessions)
      .where(eq(workSessions.id, parentId))
      .for("update");
    if (!parent || parent.role !== "orchestrator")
      throw new Error("Solo el orquestador puede delegar.");
    const children = await tx
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(eq(workSessions.threadId, parent.threadId));
    if (children.length >= 16)
      throw new Error(
        "Este hilo ya tiene 15 subagentes. Reutiliza una conversación existente.",
      );
    const id = nanoid();
    await tx.insert(workSessions).values({
      id,
      threadId: parent.threadId,
      parentId,
      name,
      role: "worker",
    });
    await tx.insert(workTurns).values({
      id: nanoid(),
      sessionId: id,
      userId,
      prompt,
      kind: "delegation",
    });
    return { id, threadId: parent.threadId };
  });
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
    // A direct intervention in a worker always returns to the coordinator's inbox.
    // The bot's own replies never feed back into themselves.
    if (session.parentId)
      await tx.insert(workTurns).values({
        id: nanoid(),
        sessionId: session.parentId,
        userId: turn.userId,
        kind: "notification",
        prompt: `Actualización de ${session.name} (${session.id}). Estado: ${status}.\nPetición recibida: ${turn.prompt.slice(0, 4000)}\nResultado:\n${result.slice(0, 12000)}`,
      });
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
