import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channelMembers, channels, messages, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

/**
 * Resumen para la barra lateral: canales visibles con no-leídos,
 * DMs con el nombre del interlocutor y lista de usuarios.
 * El cliente lo consulta por polling.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const memberships = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, user.id));
  const memberIds = memberships.map((m) => m.channelId);

  const visibleChannels = await db
    .select()
    .from(channels)
    .where(
      user.role === "guest"
        ? memberIds.length > 0
          ? inArray(channels.id, memberIds)
          : sql`false`
        : memberIds.length > 0
          ? or(eq(channels.type, "public"), inArray(channels.id, memberIds))
          : eq(channels.type, "public"),
    )
    .orderBy(asc(channels.name));

  // No-leídos por canal: mensajes de otros posteriores a mi last_read_at.
  const unreadRows = await db
    .select({
      channelId: messages.channelId,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, messages.channelId),
        eq(channelMembers.userId, user.id),
      ),
    )
    .where(
      and(
        sql`${messages.createdAt} > ${channelMembers.lastReadAt}`,
        ne(messages.userId, user.id),
      ),
    )
    .groupBy(messages.channelId);
  const unreadByChannel = new Map(unreadRows.map((r) => [r.channelId, r.count]));

  // Para los DMs, averiguar quién es la otra persona.
  const dmIds = visibleChannels.filter((c) => c.type === "dm").map((c) => c.id);
  const dmPartners =
    dmIds.length > 0
      ? await db
          .select({
            channelId: channelMembers.channelId,
            userId: users.id,
            name: users.name,
          })
          .from(channelMembers)
          .innerJoin(users, eq(users.id, channelMembers.userId))
          .where(
            and(
              inArray(channelMembers.channelId, dmIds),
              ne(channelMembers.userId, user.id),
            ),
          )
      : [];
  const partnerByChannel = new Map(
    dmPartners.map((p) => [p.channelId, { id: p.userId, name: p.name }]),
  );

  const allUsers = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .orderBy(asc(users.name));

  return NextResponse.json({
    user,
    channels: visibleChannels.map((c) => ({
      id: c.id,
      name: c.type === "dm" ? (partnerByChannel.get(c.id)?.name ?? "DM") : c.name,
      type: c.type,
      unread: unreadByChannel.get(c.id) ?? 0,
      dmUserId: c.type === "dm" ? partnerByChannel.get(c.id)?.id : undefined,
    })),
    users: allUsers,
  });
}
