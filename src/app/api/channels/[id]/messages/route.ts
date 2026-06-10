import { and, asc, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages, users } from "@/db/schema";
import { getAccessibleChannel, markChannelRead } from "@/lib/channels";
import { getSessionUser } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  const after = new URL(req.url).searchParams.get("after");
  const baseQuery = db
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
    .innerJoin(users, eq(users.id, messages.userId));

  if (after) {
    const rows = await baseQuery
      .where(
        and(eq(messages.channelId, id), gt(messages.createdAt, new Date(after))),
      )
      .orderBy(asc(messages.createdAt));
    return NextResponse.json({ messages: rows });
  }

  // Carga inicial: últimos 200 mensajes en orden cronológico.
  const rows = await baseQuery
    .where(eq(messages.channelId, id))
    .orderBy(desc(messages.createdAt))
    .limit(200);
  return NextResponse.json({ messages: rows.reverse() });
}

export async function POST(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
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
    channelId: id,
    userId: user.id,
    content,
    attachmentUrl,
    attachmentName,
    attachmentType: attachmentUrl ? (attachmentType ?? "file") : null,
  });
  await markChannelRead(user.id, id);

  return NextResponse.json({ id: messageId });
}
