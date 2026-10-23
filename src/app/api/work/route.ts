import { and, desc, eq, or, sql } from "drizzle-orm";
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
      worktree: workThreads.worktree,
      handle: agents.handle,
      machine: machines.name,
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
      ),
    )
    .orderBy(desc(workThreads.createdAt))
    .limit(100);
  return NextResponse.json({ threads });
}
