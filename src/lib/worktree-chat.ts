import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  agents,
  channelMembers,
  channels,
  machines,
  messages,
  users,
  workSessions,
  workThreads,
} from "@/db/schema";
import type { SessionUser } from "@/lib/session";

/** Opening the same worktree concurrently must never create two agents. */
export async function openWorktreeChat(
  user: SessionUser,
  machineId: string,
  worktree: string,
  runtimeId?: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["worktree-chat", machineId, worktree])}, 0))`,
    );
    const machine = await tx.query.machines.findFirst({
      where: eq(machines.id, machineId),
    });
    if (!machine) throw new Error("Máquina no encontrada.");
    const sessions = await tx
      .select({ session: workSessions, thread: workThreads, channel: channels })
      .from(workSessions)
      .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
      .innerJoin(agents, eq(agents.id, workThreads.agentId))
      .innerJoin(channels, eq(channels.id, workThreads.channelId))
      .where(
        and(
          eq(agents.machineId, machineId),
          sql`coalesce(${workSessions.worktree}, case when ${workSessions.role} = 'orchestrator' then ${workThreads.worktree} end) = ${worktree}`,
          sql`${workSessions.closedAt} is null`,
          runtimeId ? eq(workSessions.runtimeId, runtimeId) : undefined,
        ),
      )
      .orderBy(asc(workSessions.createdAt));
    const memberships = sessions.length
      ? await tx
          .select()
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.userId, user.id),
              inArray(
                channelMembers.channelId,
                sessions.map((s) => s.channel.id),
              ),
            ),
          )
      : [];
    const existing = sessions.find(
      ({ channel }) =>
        (user.role !== "guest" && channel.type === "public") ||
        memberships.some((member) => member.channelId === channel.id),
    );
    if (existing)
      return { threadId: existing.thread.id, sessionId: existing.session.id };
    if (sessions.length)
      throw new Error(
        "La conversación de este worktree pertenece a un canal al que no tienes acceso.",
      );
    if (user.role === "guest")
      throw new Error("Solo los miembros pueden abrir nuevas conversaciones.");
    const tree = machine.worktrees.find((tree) => tree.worktree === worktree);
    if (
      !tree ||
      !machine.tokenHash ||
      !machine.repositories.some((repo) => repo.id === tree.repository)
    )
      throw new Error("Este worktree ya no está compartido.");
    if (!machine.capabilities.includes("worktree-chat.v1"))
      throw new Error(
        "Actualiza y reinicia el puente de Orca para abrir este worktree desde Slak.",
      );
    if (
      !machine.lastSeenAt ||
      machine.lastSeenAt.getTime() < Date.now() - 60_000
    )
      throw new Error("Conecta la máquina para abrir esta conversación.");
    const native = runtimeId
      ? tree.nativeSessions?.find((s) => s.id === runtimeId)
      : tree.nativeSessions?.[0];
    if (runtimeId && !native)
      throw new Error(
        "La sesión ya no está disponible. Actualiza el worktree.",
      );
    if (native) {
      // A runtime may already belong to a private thread with an old workspace binding.
      const bound = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
        .innerJoin(agents, eq(agents.id, workThreads.agentId))
        .where(
          and(
            eq(agents.machineId, machineId),
            eq(workSessions.runtimeId, native.id),
          ),
        )
        .limit(1);
      if (bound.length)
        throw new Error(
          "Esta sesión ya está vinculada a otra conversación de Slak.",
        );
    }
    const terminal = !native
      ? machine.sessions.find((session) => session.worktree === worktree)
      : null;
    // Internal transport identity, created only when opening a session.
    // Native sessions need no project parent or orchestration setup.
    let bot = terminal
      ? await tx.query.agents.findFirst({
          where: and(
            eq(agents.machineId, machineId),
            eq(agents.worktree, worktree),
            eq(agents.mode, "session"),
          ),
        })
      : undefined;
    if (!bot) {
      const id = nanoid();
      await tx.insert(users).values({
        id,
        name: tree.name,
        email: `${id}@agents.slak.invalid`,
        passwordHash: "disabled",
        kind: "agent",
        role: "guest",
      });
      [bot] = await tx
        .insert(agents)
        .values({
          id,
          handle: `session-${nanoid(12).toLowerCase()}`,
          mode: terminal ? "session" : "orchestrator",
          machineId,
          repository: tree.repository,
          worktree: terminal ? worktree : "",
          machine: machine.name,
          runtimeHandle: terminal?.runtimeHandle,
          provider: native?.provider || terminal?.provider || "codex",
          state: "ready",
          createdBy: user.id,
        })
        .returning();
    }
    if (bot.state !== "ready")
      throw new Error("Esta sesión no está disponible.");
    const channelId = nanoid(),
      rootId = nanoid(),
      threadId = nanoid(),
      sessionId = nanoid();
    await tx.insert(channels).values({
      id: channelId,
      name: `Worktree · ${tree.name}`.slice(0, 100),
      isWorktree: true,
      type: "private",
      createdBy: user.id,
    });
    await tx.insert(channelMembers).values(
      [...new Set([user.id, machine.ownerId, bot.id])].map((userId) => ({
        channelId,
        userId,
      })),
    );
    await tx.insert(messages).values({
      id: rootId,
      channelId,
      userId: user.id,
      content: `Conversación de ${tree.name}`,
    });
    await tx.insert(workThreads).values({
      id: threadId,
      agentId: bot.id,
      channelId,
      rootMessageId: rootId,
      title: tree.name,
      objective: `Trabajar con el equipo en ${tree.name}.`,
      repository: tree.repository,
      worktree,
      createdBy: user.id,
    });
    await tx.insert(workSessions).values({
      id: sessionId,
      threadId,
      role: "orchestrator",
      name: native?.name || terminal?.name || "Nueva conversación",
      worktree,
      runtimeId: native?.id,
      imported: !!native,
      provider: native?.provider,
    });
    return { threadId, sessionId };
  });
}

export async function listWorktreeChats(
  user: SessionUser,
  machineId: string,
  worktree: string,
) {
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, machineId),
  });
  if (!machine) throw new Error("Máquina no encontrada.");
  const rows = await db
    .select({
      session: workSessions,
      thread: workThreads,
      channel: channels,
      accessible: sql<boolean>`(${channels.type} = 'public' and ${user.role !== "guest"}) or exists (select 1 from channel_members cm where cm.channel_id = ${channels.id} and cm.user_id = ${user.id})`,
    })
    .from(workSessions)
    .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
    .innerJoin(agents, eq(agents.id, workThreads.agentId))
    .innerJoin(channels, eq(channels.id, workThreads.channelId))
    .where(eq(agents.machineId, machineId))
    .orderBy(asc(workSessions.createdAt));
  const tree = machine.worktrees.find((tree) => tree.worktree === worktree);
  const accessible = rows.filter(
    ({ session, thread, accessible }) =>
      accessible &&
      !session.closedAt &&
      (session.worktree ||
        (session.role === "orchestrator" ? thread.worktree : null)) ===
        worktree,
  );
  if (!accessible.length && (!tree || user.role === "guest"))
    throw new Error("Worktree no disponible.");
  const bound = new Set(
    rows.map(({ session }) => session.runtimeId).filter(Boolean),
  );
  const sessions = [
    ...accessible.map(({ session, thread }) => ({
      id: session.runtimeId ? `native:${session.runtimeId}` : session.id,
      threadId: thread.id,
      sessionId: session.id,
      runtimeId: session.runtimeId,
      name: session.name,
      state: session.state,
    })),
    ...(user.role !== "guest" && machine.tokenHash
      ? (tree?.nativeSessions ?? [])
      : []
    )
      .filter((session) => !bound.has(session.id))
      .map((session) => ({
        id: `native:${session.id}`,
        runtimeId: session.id,
        name:
          session.name || (session.provider === "claude" ? "Claude" : "Codex"),
        state: "idle" as const,
        threadId: null,
        sessionId: null,
      })),
  ];
  return {
    name: tree?.name || worktree.split("/").at(-1) || worktree,
    machine: machine.name,
    online:
      !!machine.tokenHash &&
      !!machine.lastSeenAt &&
      machine.lastSeenAt.getTime() > Date.now() - 60_000,
    sessions,
    canOpen:
      user.role !== "guest" &&
      !!tree &&
      !!machine.tokenHash &&
      machine.capabilities.includes("worktree-chat.v1"),
  };
}
