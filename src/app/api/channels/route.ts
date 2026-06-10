import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channelMembers, channels } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "guest") {
    return NextResponse.json(
      { error: "Los invitados no pueden crear canales." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const rawName = String(body?.name ?? "").trim();
  const isPrivate = Boolean(body?.isPrivate);
  const description = body?.description ? String(body.description).trim() : null;

  const name = rawName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_áéíóúñü]/g, "")
    .slice(0, 50);
  if (!name) {
    return NextResponse.json({ error: "El canal necesita un nombre." }, { status: 400 });
  }

  const id = nanoid();
  await db.insert(channels).values({
    id,
    name,
    description,
    type: isPrivate ? "private" : "public",
    createdBy: user.id,
  });
  await db.insert(channelMembers).values({ channelId: id, userId: user.id });

  return NextResponse.json({ id, name });
}
