import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channels,
  messages,
  workThreads,
  workSessions,
  workTurns,
} from "@/db/schema";
import { assertWorktreeNotClosing } from "@/lib/work";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newAgentToken() {
  const token = `slak_${randomBytes(32).toString("hex")}`;
  return { token, tokenHash: hashToken(token) };
}

export async function authenticateAgent(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (slak_[a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  return (
    (await db.query.agents.findFirst({
      where: eq(agents.tokenHash, hashToken(token)),
    })) ?? null
  );
}

export async function agentInbox(agentId: string) {
  return db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.agentId, agentId),
        inArray(agentTasks.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(agentTasks.createdAt))
    .limit(100);
}

export async function claimTask(agentId: string, taskId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: workSessions.id })
      .from(workSessions)
      .innerJoin(workThreads, eq(workThreads.id, workSessions.threadId))
      .where(eq(workThreads.agentId, agentId))
      .limit(1);
    if (session) await assertWorktreeNotClosing(tx, session.id);
    const [task] = await tx
      .update(agentTasks)
      .set({ status: "running", updatedAt: new Date() })
      .where(
        and(
          eq(agentTasks.id, taskId),
          eq(agentTasks.agentId, agentId),
          eq(agentTasks.status, "queued"),
        ),
      )
      .returning();
    if (!task) throw new Error("La tarea ya fue recogida o no te pertenece.");
    await tx
      .update(workTurns)
      .set({ status: "running", updatedAt: new Date() })
      .where(
        and(eq(workTurns.id, taskId), eq(workTurns.messageId, task.messageId)),
      );
    return task;
  });
}

export async function finishTask(
  agentId: string,
  taskId: string,
  status: "completed" | "failed",
  result: string,
) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(agentTasks)
      .set({ status, result, updatedAt: new Date() })
      .where(
        and(
          eq(agentTasks.id, taskId),
          eq(agentTasks.agentId, agentId),
          eq(agentTasks.status, "running"),
        ),
      )
      .returning();
    // Compare-and-set makes a repeated completion safe: never post the same answer twice.
    if (!task) throw new Error("La tarea no está en curso o no te pertenece.");
    await tx
      .update(workTurns)
      .set({ status, result, updatedAt: new Date() })
      .where(
        and(eq(workTurns.id, taskId), eq(workTurns.messageId, task.messageId)),
      );
    const [source] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, task.messageId));
    const [channel] = await tx
      .select()
      .from(channels)
      .where(eq(channels.id, task.channelId));
    await tx.insert(messages).values({
      id: nanoid(),
      channelId: task.channelId,
      userId: agentId,
      parentId: source.parentId ?? (channel.type === "dm" ? null : source.id),
      content:
        status === "failed" ? `No pude completar la tarea: ${result}` : result,
    });
    return task;
  });
}
