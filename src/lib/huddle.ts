import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { huddleParticipants, huddleSignals, users } from "@/db/schema";

// Un participante sin heartbeat en este margen se considera desconectado.
export const STALE_MS = 20_000;

export async function getActiveParticipants(channelId: string) {
  const cutoff = new Date(Date.now() - STALE_MS);
  return db
    .select({ id: users.id, name: users.name })
    .from(huddleParticipants)
    .innerJoin(users, eq(users.id, huddleParticipants.userId))
    .where(
      and(
        eq(huddleParticipants.channelId, channelId),
        gt(huddleParticipants.lastSeenAt, cutoff),
      ),
    );
}

export async function cleanupStale(channelId: string) {
  const cutoff = new Date(Date.now() - STALE_MS);
  await db
    .delete(huddleParticipants)
    .where(
      and(
        eq(huddleParticipants.channelId, channelId),
        lt(huddleParticipants.lastSeenAt, cutoff),
      ),
    );
  // Señales que nadie recogió (p. ej. de pestañas cerradas).
  await db
    .delete(huddleSignals)
    .where(
      and(
        eq(huddleSignals.channelId, channelId),
        lt(huddleSignals.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
}

export async function removeParticipant(channelId: string, userId: string) {
  await db
    .delete(huddleParticipants)
    .where(
      and(
        eq(huddleParticipants.channelId, channelId),
        eq(huddleParticipants.userId, userId),
      ),
    );
  await db
    .delete(huddleSignals)
    .where(
      and(
        eq(huddleSignals.channelId, channelId),
        eq(huddleSignals.toUserId, userId),
      ),
    );
}
