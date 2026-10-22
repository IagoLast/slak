import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channelMembers,
  channels,
  messages,
  users,
} from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { getSessionUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const channelId = new URL(req.url).searchParams.get("channelId");
  const access = or(
    user.role !== "guest" ? eq(channels.type, "public") : sql`false`,
    sql`exists (select 1 from channel_members cm where cm.channel_id = ${channels.id} and cm.user_id = ${user.id})`,
  );
  const rows = await db
    .select({
      id: agentTasks.id,
      agentId: agentTasks.agentId,
      channelId: agentTasks.channelId,
      messageId: agentTasks.messageId,
      prompt: agentTasks.prompt,
      kind: agentTasks.kind,
      status: agentTasks.status,
      result: agentTasks.result,
      createdAt: agentTasks.createdAt,
      updatedAt: agentTasks.updatedAt,
      agentName: users.name,
      agentHandle: agents.handle,
    })
    .from(agentTasks)
    .innerJoin(channels, eq(channels.id, agentTasks.channelId))
    .innerJoin(agents, eq(agents.id, agentTasks.agentId))
    .innerJoin(users, eq(users.id, agents.id))
    .where(and(access, channelId ? eq(channels.id, channelId) : undefined))
    .orderBy(desc(agentTasks.createdAt))
    .limit(100);
  return NextResponse.json({ tasks: rows });
}

const taskSchema = z.object({
  agentId: z.string().min(1),
  channelId: z.string().min(1),
  prompt: z.string().trim().min(1).max(16000),
});
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = taskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Elige un agente, un canal y describe la tarea." },
      { status: 400 },
    );
  const { agentId, channelId, prompt } = parsed.data;
  const channel = await getAccessibleChannel(user, channelId);
  if (!channel)
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  const [agent] = await db
    .select()
    .from(agents)
    .innerJoin(channelMembers, eq(channelMembers.userId, agents.id))
    .where(
      and(
        eq(agents.id, agentId),
        eq(channelMembers.channelId, channelId),
        or(isNotNull(agents.tokenHash), isNotNull(agents.machineId)),
      ),
    );
  if (!agent)
    return NextResponse.json(
      { error: "Añade primero un agente activo a este canal desde Miembros." },
      { status: 400 },
    );
  const id = nanoid(),
    messageId = nanoid();
  await db.transaction(async (tx) => {
    await tx
      .insert(messages)
      .values({
        id: messageId,
        channelId,
        userId: user.id,
        content: `Tarea para @${agent.agents.handle}:\n\n${prompt}`,
      });
    await tx
      .insert(agentTasks)
      .values({
        id,
        agentId,
        channelId,
        messageId,
        createdBy: user.id,
        prompt,
      });
  });
  return NextResponse.json({ id, messageId }, { status: 201 });
}
