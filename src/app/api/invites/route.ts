import { desc, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const pending = await db
    .select()
    .from(invites)
    .where(isNull(invites.usedAt))
    .orderBy(desc(invites.createdAt));

  return NextResponse.json({ invites: pending });
}

/** Crea un enlace de invitación (miembro de la empresa o invitado externo). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = body?.email ? String(body.email).toLowerCase().trim() : null;
  const role = body?.role === "guest" ? "guest" : "member";
  const channelIds = Array.isArray(body?.channelIds)
    ? body.channelIds.map(String)
    : [];

  if (role === "guest" && channelIds.length === 0) {
    return NextResponse.json(
      { error: "Un invitado externo necesita al menos un canal." },
      { status: 400 },
    );
  }

  const token = nanoid(32);
  await db.insert(invites).values({
    token,
    email,
    role,
    channelIds,
    createdBy: user.id,
  });

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    token,
    url: `${origin}/register?token=${token}`,
  });
}
