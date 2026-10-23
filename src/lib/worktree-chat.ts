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
    let bot = terminal
      ? await tx.query.agents.findFirst({
          where: and(
            eq(agents.machineId, machineId),
            eq(agents.worktree, worktree),
          ),
        })
      : await tx.query.agents.findFirst({
          where: and(
            eq(agents.machineId, machineId),
            eq(agents.repository, tree.repository),
            eq(agents.mode, "orchestrator"),
          ),
        });
    if (terminal && !bot) {
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
          handle: `wt-${nanoid(12).toLowerCase()}`,
          mode: "session",
          machineId,
          repository: tree.repository,
          worktree,
          machine: machine.name,
          runtimeHandle: terminal.runtimeHandle,
          provider: terminal.provider,
          state: "ready",
          createdBy: user.id,
        })
        .returning();
    }
    if (!bot || bot.state !== "ready")
      throw new Error("El agente del proyecto no está disponible.");
    const channelId = nanoid(),
      rootId = nanoid(),
      threadId = nanoid(),
      sessionId = nanoid();
    await tx.insert(channels).values({
      id: channelId,
      name: `Worktree · ${tree.name}`.slice(0, 100),
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
      name: native?.name || "Agente del worktree",
      worktree,
      runtimeId: native?.id,
      imported: !!native,
      provider: native?.provider,
    });
    return { threadId, sessionId };
  });
}
