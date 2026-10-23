import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channelMembers,
  machines,
  messages,
  users,
  workActions,
  workEvents,
  workSessions,
  workThreads,
  workTurns,
} from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { getSessionUser } from "@/lib/session";
import { assertWorktreeNotClosing, queueWorkAction } from "@/lib/work";

async function access(id: string) {
  const user = await getSessionUser();
  if (!user) return null;
  const thread = await db.query.workThreads.findFirst({
    where: eq(workThreads.id, id),
  });
  if (!thread || !(await getAccessibleChannel(user, thread.channelId)))
    return null;
  return { user, thread };
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const found = await access((await params).id);
  if (!found)
    return NextResponse.json(
      { error: "Conversación no encontrada" },
      { status: 404 },
    );
  const { thread } = found;
  const query = new URL(req.url).searchParams;
  const sessions = await db
    .select({
      id: workSessions.id,
      name: workSessions.name,
      role: workSessions.role,
      parentId: workSessions.parentId,
      worktree: workSessions.worktree,
      closedAt: workSessions.closedAt,
      state: workSessions.state,
      memory: workSessions.memory,
      memoryVersion: workSessions.memoryVersion,
      context: workSessions.context,
      generation: workSessions.generation,
      error: workSessions.error,
      lastSeenAt: workSessions.lastSeenAt,
    })
    .from(workSessions)
    .where(eq(workSessions.threadId, thread.id))
    .orderBy(asc(workSessions.createdAt));
  const selected = query.has("session")
    ? sessions.find((s) => s.id === query.get("session"))
    : sessions.find((s) => s.role === "orchestrator");
  if (!selected)
    return NextResponse.json(
      { error: "Sesión no encontrada" },
      { status: 404 },
    );
  const cursorSchema = z.object({
    at: z.iso.datetime(),
    id: z.string().max(4096),
    sequence: z.number().int().nonnegative().optional(),
  });
  function readCursor(name: string) {
    const value = query.get(name);
    if (!value || value === "done") return null;
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  }
  let eventCursor, turnCursor;
  try {
    eventCursor = readCursor("eventCursor");
    turnCursor = readCursor("turnCursor");
  } catch {
    return NextResponse.json({ error: "Cursor no válido" }, { status: 400 });
  }
  const encodeCursor = (at: Date, id: string, sequence?: number) =>
    Buffer.from(
      JSON.stringify({ at: at.toISOString(), id, sequence }),
    ).toString("base64url");
  const [events, turns, actions, bot, membership] = await Promise.all([
    db
      .select()
      .from(workEvents)
      .where(
        and(
          eq(workEvents.sessionId, selected.id),
          query.get("eventCursor") === "done"
            ? sql`false`
            : eventCursor
              ? sql`(${workEvents.observedAt}, ${workEvents.sequence}, ${workEvents.itemId}) < (${eventCursor.at}::timestamptz, ${eventCursor.sequence ?? 0}, ${eventCursor.id})`
              : undefined,
        ),
      )
      .orderBy(
        desc(workEvents.observedAt),
        desc(workEvents.sequence),
        desc(workEvents.itemId),
      )
      .limit(201),
    db
      .select({
        id: workTurns.id,
        prompt: workTurns.prompt,
        result: sql<
          string | null
        >`coalesce(${agentTasks.result}, ${workTurns.result})`,
        kind: workTurns.kind,
        status: sql<
          typeof workTurns.$inferSelect.status
        >`coalesce(${agentTasks.status}, ${workTurns.status})`,
        createdAt: workTurns.createdAt,
        author: users.name,
      })
      .from(workTurns)
      .innerJoin(users, eq(users.id, workTurns.userId))
      .leftJoin(
        agentTasks,
        and(
          eq(agentTasks.id, workTurns.id),
          eq(agentTasks.messageId, workTurns.messageId),
          eq(agentTasks.agentId, thread.agentId),
        ),
      )
      .where(
        and(
          eq(workTurns.sessionId, selected.id),
          query.get("turnCursor") === "done"
            ? sql`false`
            : turnCursor
              ? sql`(${workTurns.createdAt}, ${workTurns.id}) < (${turnCursor.at}::timestamptz, ${turnCursor.id})`
              : undefined,
        ),
      )
      .orderBy(desc(workTurns.createdAt), desc(workTurns.id))
      .limit(101),
    db
      .select()
      .from(workActions)
      .where(eq(workActions.sessionId, selected.id))
      .orderBy(desc(workActions.createdAt))
      .limit(10),
    db
      .select({
        handle: agents.handle,
        mode: agents.mode,
        name: users.name,
        state: agents.state,
        machine: machines.name,
        machineOwnerId: machines.ownerId,
        machineId: machines.id,
        capabilities: machines.capabilities,
        worktrees: machines.worktrees,
        lastSeenAt: machines.lastSeenAt,
        enabled: sql<boolean>`${machines.tokenHash} is not null`,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.id))
      .leftJoin(machines, eq(machines.id, agents.machineId))
      .where(eq(agents.id, thread.agentId)),
    db.query.channelMembers.findFirst({
      where: and(
        eq(channelMembers.channelId, thread.channelId),
        eq(channelMembers.userId, thread.agentId),
      ),
    }),
  ]);
  const pageEvents = events.slice(0, 200);
  const turnIds = [
    ...new Set(
      pageEvents.flatMap((event) =>
        typeof event.body.turnId === "string" ? [event.body.turnId] : [],
      ),
    ),
  ];
  // A long turn may start on an older page. Include its lifecycle so the
  // answers-only view can recognize completion without loading all tool events.
  const lifecycles = turnIds.length
    ? await db
        .select()
        .from(workEvents)
        .where(
          and(
            eq(workEvents.sessionId, selected.id),
            inArray(workEvents.itemId, turnIds),
          ),
        )
    : [];
  if (bot[0]?.mode === "session" && !selected.closedAt)
    selected.state = turns.some((turn) => turn.status === "running")
      ? "running"
      : "idle";
  const { worktrees: catalog, ...botInfo } = bot[0] ?? {};
  const workspace = catalog?.find(
    (tree) =>
      tree.worktree ===
      (selected.worktree ||
        (selected.role === "orchestrator" ? thread.worktree : null)),
  );
  return NextResponse.json({
    thread,
    workspace: workspace
      ? { name: workspace.name, branch: workspace.branch }
      : null,
    sessions,
    selectedId: selected.id,
    events: [
      ...new Map(
        [...pageEvents.reverse(), ...lifecycles].map((event) => [
          event.itemId,
          event,
        ]),
      ).values(),
    ],
    turns: turns.slice(0, 100).reverse(),
    actions,
    bot: {
      ...botInfo,
      online:
        !!bot[0]?.enabled &&
        !!bot[0]?.lastSeenAt &&
        bot[0].lastSeenAt.getTime() > Date.now() - 60000,
    },
    canSend:
      !selected.closedAt &&
      !!membership &&
      !!bot[0]?.enabled &&
      bot[0]?.state === "ready",
    canManage: found.user.role !== "guest" && bot[0]?.mode === "orchestrator",
    canInterrupt: !!bot[0]?.capabilities?.includes("session-interrupt.v1"),
    canCloseWorktree:
      !selected.closedAt &&
      !!bot[0]?.capabilities?.includes("worktree-close.v1") &&
      !!(
        selected.worktree ||
        (selected.role === "orchestrator" ? thread.worktree : null)
      ) &&
      (found.user.role === "admin" || found.user.id === bot[0]?.machineOwnerId),
    hasOlder: events.length > 200 || turns.length > 100,
    next: {
      events:
        events.length > 200
          ? encodeCursor(
              events[199].observedAt,
              events[199].itemId,
              events[199].sequence,
            )
          : null,
      turns:
        turns.length > 100
          ? encodeCursor(turns[99].createdAt, turns[99].id)
          : null,
    },
  });
}

const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("message"),
    sessionId: z.string().optional(),
    content: z.string().trim().min(1).max(16000),
    requestId: z.string().min(16).max(100),
  }),
  z.object({
    action: z.enum([
      "stop",
      "interrupt",
      "compact",
      "rotate",
      "close-worktree",
    ]),
    sessionId: z.string().min(1),
  }),
  z
    .object({
      action: z.literal("respond"),
      sessionId: z.string().min(1),
      itemId: z.string().min(1).max(4096),
      revision: z.number().int().positive(),
      optionId: z.string().min(1).max(4096).optional(),
      answers: z
        .array(
          z.object({
            questionId: z.string().min(1).max(4096),
            optionIds: z.array(z.string().max(4096)).max(64),
            other: z.string().max(16000).optional(),
          }),
        )
        .min(1)
        .max(4)
        .optional(),
    })
    .refine((v) => !!v.optionId !== !!v.answers),
]);
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const found = await access((await params).id);
  if (!found)
    return NextResponse.json(
      { error: "Conversación no encontrada" },
      { status: 404 },
    );
  const parsed = command.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  const { thread, user } = found;
  const body = parsed.data;
  const bot = await db.query.agents.findFirst({
    where: eq(agents.id, thread.agentId),
  });
  const membership = await db.query.channelMembers.findFirst({
    where: and(
      eq(channelMembers.channelId, thread.channelId),
      eq(channelMembers.userId, thread.agentId),
    ),
  });
  if (!membership || bot?.state !== "ready")
    return NextResponse.json(
      { error: "La sesión ya no está disponible para esta conversación." },
      { status: 409 },
    );
  const session = await db.query.workSessions.findFirst({
    where: and(
      eq(workSessions.threadId, thread.id),
      "sessionId" in body && body.sessionId
        ? eq(workSessions.id, body.sessionId)
        : eq(workSessions.role, "orchestrator"),
    ),
  });
  if (!session)
    return NextResponse.json(
      { error: "Sesión no encontrada" },
      { status: 404 },
    );
  try {
    if (session.closedAt) throw new Error("Este worktree está cerrado.");
    if (body.action === "close-worktree") {
      const machine = bot?.machineId
        ? await db.query.machines.findFirst({
            where: eq(machines.id, bot.machineId),
          })
        : null;
      if (!machine || (user.role !== "admin" && user.id !== machine.ownerId))
        return NextResponse.json(
          {
            error:
              "Solo el propietario de la máquina o un administrador puede cerrar worktrees.",
          },
          { status: 403 },
        );
      const worktree =
        session.worktree ||
        (session.role === "orchestrator" ? thread.worktree : null);
      if (!worktree)
        throw new Error("Esta conversación no tiene un worktree asignado.");
      return NextResponse.json(
        await queueWorkAction(session.id, "close-worktree", { worktree }),
      );
    }
    if (body.action === "message") {
      if (session.state === "stopped")
        throw new Error("Reanuda la conversación antes de enviar un mensaje.");
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(workSessions)
          .where(eq(workSessions.id, session.id))
          .for("update");
        if (current.closedAt || current.state === "stopped")
          throw new Error("La sesión está cerrada o detenida.");
        await assertWorktreeNotClosing(tx, session.id);
        const pending = await tx.query.workActions.findFirst({
          where: and(
            eq(workActions.sessionId, session.id),
            inArray(workActions.kind, [
              "stop",
              "interrupt",
              "rotate",
              "close-worktree",
            ]),
            inArray(workActions.status, ["queued", "running"]),
          ),
        });
        if (pending)
          throw new Error("Espera a que termine la operación pendiente.");
        const [existing] = await tx
          .select()
          .from(workTurns)
          .where(eq(workTurns.id, body.requestId));
        if (existing) {
          if (
            existing.sessionId !== session.id ||
            existing.userId !== user.id ||
            existing.prompt !== body.content
          )
            throw new Error("Identificador de envío ya utilizado.");
          return;
        }
        if (bot.mode === "session") {
          await tx.insert(messages).values({
            id: messageIdForTerminal(body.requestId),
            channelId: thread.channelId,
            parentId: thread.rootMessageId,
            userId: user.id,
            content: body.content,
          });
          await tx.insert(workTurns).values({
            id: body.requestId,
            sessionId: session.id,
            userId: user.id,
            messageId: messageIdForTerminal(body.requestId),
            prompt: body.content,
          });
          await tx.insert(agentTasks).values({
            id: body.requestId,
            agentId: bot.id,
            channelId: thread.channelId,
            messageId: messageIdForTerminal(body.requestId),
            prompt: body.content,
            kind: "message",
            createdBy: user.id,
          });
          return;
        }
        const messageId = nanoid();
        if (session.role === "orchestrator")
          await tx.insert(messages).values({
            id: messageId,
            channelId: thread.channelId,
            parentId: thread.rootMessageId,
            userId: user.id,
            content: body.content,
          });
        await tx.insert(workTurns).values({
          id: body.requestId,
          sessionId: session.id,
          userId: user.id,
          messageId: session.role === "orchestrator" ? messageId : null,
          prompt: body.content,
        });
      });
      return NextResponse.json({ queued: true });
    }
    if (
      user.role === "guest" &&
      ["stop", "interrupt", "compact", "rotate"].includes(body.action)
    )
      return NextResponse.json(
        { error: "Solo los miembros pueden gestionar sesiones." },
        { status: 403 },
      );
    if (bot.mode === "session")
      throw new Error(
        "Esta sesión de terminal se gestiona desde Orca. Puedes cerrar el worktree desde Slak.",
      );
    if (body.action === "respond") {
      const event = await db.query.workEvents.findFirst({
        where: and(
          eq(workEvents.sessionId, session.id),
          eq(workEvents.itemId, body.itemId),
        ),
      });
      if (
        !event ||
        event.revision !== body.revision ||
        !["approval", "question"].includes(String(event.body.kind)) ||
        (event.body.resolution as { state?: string } | undefined)?.state !==
          "pending"
      )
        throw new Error("La solicitud ya cambió. Actualiza la conversación.");
      if (event.body.kind === "approval" && !body.optionId)
        throw new Error("Selecciona una opción de la solicitud.");
      return NextResponse.json(
        await queueWorkAction(session.id, "respond", {
          itemId: body.itemId,
          expectedRevision: body.revision,
          ...(body.optionId
            ? { optionId: body.optionId }
            : { answers: body.answers }),
          kind: event.body.kind,
        }),
      );
    }
    return NextResponse.json(await queueWorkAction(session.id, body.action));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}

function messageIdForTerminal(requestId: string) {
  return `work-${requestId}`;
}
