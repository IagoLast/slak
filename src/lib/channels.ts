import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { Channel, channelMembers, channels } from "@/db/schema";
import { SessionUser } from "@/lib/session";

/**
 * Devuelve el canal si el usuario puede acceder a él, o null.
 * - Canales públicos: cualquier admin/miembro (los invitados externos no).
 * - Privados y DMs: solo sus miembros.
 */
export async function getAccessibleChannel(
  user: SessionUser,
  channelId: string,
): Promise<Channel | null> {
  const channel = await db.query.channels.findFirst({
    where: eq(channels.id, channelId),
  });
  if (!channel) return null;

  if (channel.type === "public" && user.role !== "guest") return channel;

  const member = await db.query.channelMembers.findFirst({
    where: and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.userId, user.id),
    ),
  });
  return member ? channel : null;
}

/** Marca el canal como leído (y une al usuario si aún no era miembro). */
export async function markChannelRead(userId: string, channelId: string) {
  await db
    .insert(channelMembers)
    .values({ channelId, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [channelMembers.channelId, channelMembers.userId],
      set: { lastReadAt: new Date() },
    });
}
