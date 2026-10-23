import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channelMembers, channels, invites } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { z } from "zod";

const invitation = z.object({
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  role: z.enum(["member", "guest"]).default("member"),
  channelIds: z.array(z.string().min(1).max(100)).max(100).default([]),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo administradores" },
      { status: 403 },
    );
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
    return NextResponse.json(
      { error: "Solo administradores" },
      { status: 403 },
    );
  }

  const parsed = invitation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Revisa el email, el tipo de invitación y los canales." },
      { status: 400 },
    );
  }
  const { email, role } = parsed.data;
  const channelIds = [...new Set(parsed.data.channelIds)];

  if (role === "guest" && channelIds.length === 0) {
    return NextResponse.json(
      { error: "Un invitado externo necesita al menos un canal." },
      { status: 400 },
    );
  }

  if (channelIds.length) {
    const allowed = await db
      .select({ id: channels.id })
      .from(channels)
      .leftJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, channels.id),
          eq(channelMembers.userId, user.id),
        ),
      )
      .where(
        and(
          inArray(channels.id, channelIds),
          or(
            eq(channels.type, "public"),
            and(
              eq(channels.type, "private"),
              eq(channelMembers.userId, user.id),
            ),
          ),
        ),
      );
    if (allowed.length !== channelIds.length) {
      return NextResponse.json(
        { error: "Algún canal ya no está disponible para esta invitación." },
        { status: 400 },
      );
    }
  }

  const token = nanoid(32);
  await db.insert(invites).values({
    token,
    email: email ?? null,
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
