import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { agents, workSessions, workThreads } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { getAccessibleChannel } from "@/lib/channels";
import { worktreeHref } from "@/lib/workspaces";
import WorkConversation from "@/components/WorkConversation";

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const [user, { id }, { session }] = await Promise.all([
    requireUser(),
    params,
    searchParams,
  ]);
  const [found] = await db
    .select({
      session: workSessions,
      thread: workThreads,
      machineId: agents.machineId,
    })
    .from(workSessions)
    .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
    .innerJoin(agents, eq(agents.id, workThreads.agentId))
    .where(
      and(
        eq(workThreads.id, id),
        session
          ? eq(workSessions.id, session)
          : eq(workSessions.role, "orchestrator"),
      ),
    );
  if (!found || !(await getAccessibleChannel(user, found.thread.channelId)))
    notFound();
  const worktree =
    found.session.worktree ||
    (found.session.role === "orchestrator" ? found.thread.worktree : null);
  if (found.machineId && worktree && !found.session.closedAt)
    redirect(worktreeHref(found.machineId, worktree, found.session.id));
  return (
    <WorkConversation
      key={`${id}:${session || "default"}`}
      threadId={id}
      sessionId={session}
    />
  );
}
