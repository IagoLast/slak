import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages, users } from "@/db/schema";
import { getAccessibleChannel, markChannelRead } from "@/lib/channels";
import { getSessionUser, SessionUser } from "@/lib/session";

async function getThreadRoot(user: SessionUser, messageId: string) {
  const [root] = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      content: messages.content,
      attachmentUrl: messages.attachmentUrl,
      attachmentName: messages.attachmentName,
      attachmentType: messages.attachmentType,
      createdAt: messages.createdAt,
      user: { id: users.id, name: users.name },
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(and(eq(messages.id, messageId), isNull(messages.parentId)))
    .limit(1);
  if (!root) return null;

  const channel = await getAccessibleChannel(user, root.channelId);
  return channel ? root : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const root = await getThreadRoot(user, id);
  if (!root) {
    return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });
  }

  const replies = await db
    .select({
      id: messages.id,
      content: messages.content,
      attachmentUrl: messages.attachmentUrl,
      attachmentName: messages.attachmentName,
      attachmentType: messages.attachmentType,
      createdAt: messages.createdAt,
      user: { id: users.id, name: users.name },
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(eq(messages.parentId, id))
    .orderBy(asc(messages.createdAt));

  return NextResponse.json({ root, replies });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const root = await getThreadRoot(user, id);
  if (!root) {
    return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const content = body?.content ? String(body.content).trim() : null;
  const attachmentUrl = body?.attachmentUrl ? String(body.attachmentUrl) : null;
  const attachmentName = body?.attachmentName ? String(body.attachmentName) : null;
  const attachmentType = ["file", "image", "audio"].includes(body?.attachmentType)
    ? (body.attachmentType as "file" | "image" | "audio")
    : null;

  if (!content && !attachmentUrl) {
    return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });
  }

  const messageId = nanoid();
  await db.insert(messages).values({
    id: messageId,
    channelId: root.channelId,
    userId: user.id,
    parentId: id,
    content,
    attachmentUrl,
    attachmentName,
    attachmentType: attachmentUrl ? (attachmentType ?? "file") : null,
  });
  await markChannelRead(user.id, root.channelId);

  return NextResponse.json({ id: messageId });
}
