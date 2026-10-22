import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channelMembers,
  channels,
  messages,
} from "@/db/schema";
import type { SessionUser } from "@/lib/session";

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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Only current channel members can receive mentions. No implicit private-channel grants. */
export async function queueAgentMessages(
  tx: Transaction,
  input: {
    user: SessionUser;
    channelId: string;
    messageId: string;
    content: string | null;
  },
) {
  if (!input.content) return;
  const [channel] = await tx
    .select()
    .from(channels)
    .where(eq(channels.id, input.channelId));
  const recipients = await tx
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .innerJoin(channelMembers, eq(channelMembers.userId, agents.id))
    .where(
      and(
        eq(channelMembers.channelId, input.channelId),
        or(isNotNull(agents.tokenHash), isNotNull(agents.machineId)),
      ),
    );
  const mentions = new Set(
    [...input.content.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9_-]*)\b/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const targets = recipients.filter(
    (a) => channel.type === "dm" || mentions.has(a.handle),
  );
  if (targets.length)
    await tx.insert(agentTasks).values(
      targets.map((a) => ({
        id: nanoid(),
        agentId: a.id,
        channelId: input.channelId,
        messageId: input.messageId,
        createdBy: input.user.id,
        kind: "message" as const,
        prompt: input.content!,
      })),
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
  const [task] = await db
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
  return task;
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
