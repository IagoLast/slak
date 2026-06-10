import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channelMembers, users } from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { getSessionUser } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  const members = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(eq(channelMembers.channelId, id));

  return NextResponse.json({ members });
}

/** Añade un usuario a un canal (p. ej. dar acceso a un invitado externo). */
export async function POST(req: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "guest") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel || channel.type === "dm") {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const userId = String(body?.userId ?? "");
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  await db
    .insert(channelMembers)
    .values({ channelId: id, userId })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
