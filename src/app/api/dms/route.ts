import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channelMembers, channels, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

/** Abre (o reutiliza) un mensaje directo con otro usuario. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const otherId = String(body?.userId ?? "");
  if (!otherId || otherId === user.id) {
    return NextResponse.json({ error: "Usuario no válido" }, { status: 400 });
  }

  const other = await db.query.users.findFirst({ where: eq(users.id, otherId) });
  if (!other) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const mine = alias(channelMembers, "mine");
  const theirs = alias(channelMembers, "theirs");
  const [existing] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(mine, and(eq(mine.channelId, channels.id), eq(mine.userId, user.id)))
    .innerJoin(
      theirs,
      and(eq(theirs.channelId, channels.id), eq(theirs.userId, otherId)),
    )
    .where(eq(channels.type, "dm"))
    .limit(1);

  if (existing) return NextResponse.json({ channelId: existing.id });

  const id = nanoid();
  await db.insert(channels).values({
    id,
    name: "dm",
    type: "dm",
    createdBy: user.id,
  });
  await db.insert(channelMembers).values([
    { channelId: id, userId: user.id },
    { channelId: id, userId: otherId },
  ]);

  return NextResponse.json({ channelId: id });
}
