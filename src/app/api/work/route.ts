import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  agents,
  channels,
  machines,
  workSessions,
  workThreads,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const query = new URL(req.url).searchParams;
  const threads = await db
    .select({
      id: workThreads.id,
      title: workThreads.title,
      channelId: workThreads.channelId,
      rootMessageId: workThreads.rootMessageId,
      worktree: sql<
        string | null
      >`coalesce(${workSessions.worktree}, ${workThreads.worktree})`,
      sessionId: workSessions.id,
      closedAt: workSessions.closedAt,
      handle: agents.handle,
      machine: machines.name,
      machineId: agents.machineId,
      repository: workThreads.repository,
      machineSeenAt: machines.lastSeenAt,
      machineEnabled: sql<boolean>`${machines.tokenHash} is not null`,
      state: workSessions.state,
      createdAt: workThreads.createdAt,
    })
    .from(workThreads)
    .innerJoin(channels, eq(channels.id, workThreads.channelId))
    .innerJoin(agents, eq(agents.id, workThreads.agentId))
    .leftJoin(machines, eq(machines.id, agents.machineId))
    .innerJoin(
      workSessions,
      and(
        eq(workSessions.threadId, workThreads.id),
        eq(workSessions.role, "orchestrator"),
      ),
    )
    .where(
      and(
        or(
          user.role !== "guest" ? eq(channels.type, "public") : sql`false`,
          sql`exists (select 1 from channel_members cm where cm.channel_id = ${channels.id} and cm.user_id = ${user.id})`,
        ),
        query.get("channelId")
          ? eq(workThreads.channelId, query.get("channelId")!)
          : undefined,
        query.get("rootId")
          ? eq(workThreads.rootMessageId, query.get("rootId")!)
          : undefined,
        query.get("machineId")
          ? eq(agents.machineId, query.get("machineId")!)
          : undefined,
        query.get("worktree")
          ? or(
              eq(workThreads.worktree, query.get("worktree")!),
              sql`exists (select 1 from work_sessions child where child.thread_id = ${workThreads.id} and child.worktree = ${query.get("worktree")!})`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(workThreads.createdAt))
    .limit(100);
  const workers = threads.length
    ? await db
        .select({
          id: workSessions.id,
          threadId: workSessions.threadId,
          name: workSessions.name,
          worktree: workSessions.worktree,
          state: workSessions.state,
          closedAt: workSessions.closedAt,
        })
        .from(workSessions)
        .where(
          and(
            inArray(
              workSessions.threadId,
              threads.map((thread) => thread.id),
            ),
            eq(workSessions.role, "worker"),
          ),
        )
    : [];
  return NextResponse.json({
    threads: threads.map(({ machineSeenAt, machineEnabled, ...thread }) => ({
      ...thread,
      workers: workers
        .filter((worker) => worker.threadId === thread.id)
        .map(({ id, name, worktree, state, closedAt }) => ({
          id,
          name,
          worktree,
          state,
          closedAt,
        })),
      online:
        machineEnabled &&
        !!machineSeenAt &&
        machineSeenAt.getTime() > Date.now() - 60_000,
    })),
  });
}
