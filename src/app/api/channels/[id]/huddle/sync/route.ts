import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { huddleParticipants, huddleSignals } from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { cleanupStale, getActiveParticipants } from "@/lib/huddle";
import { getSessionUser } from "@/lib/session";

/**
 * Latido del huddle. En cada llamada el cliente:
 * - renueva su presencia,
 * - entrega sus señales WebRTC salientes (ofertas/respuestas/candidatos ICE),
 * - recoge las señales dirigidas a él (se borran al entregarse),
 * - recibe la lista actual de participantes.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const outgoing: { to: string; data: unknown }[] = Array.isArray(body?.signals)
    ? body.signals
        .filter((s: unknown): s is { to: string; data: unknown } => {
          const sig = s as { to?: unknown; data?: unknown };
          return typeof sig?.to === "string" && sig?.data !== undefined;
        })
        .slice(0, 50)
    : [];

  await db
    .insert(huddleParticipants)
    .values({ channelId: id, userId: user.id })
    .onConflictDoUpdate({
      target: [huddleParticipants.channelId, huddleParticipants.userId],
      set: { lastSeenAt: new Date() },
    });
  await cleanupStale(id);

  if (outgoing.length > 0) {
    await db.insert(huddleSignals).values(
      outgoing.map((s) => ({
        id: nanoid(),
        channelId: id,
        fromUserId: user.id,
        toUserId: s.to,
        payload: s.data,
      })),
    );
  }

  const inbound = await db
    .select()
    .from(huddleSignals)
    .where(
      and(eq(huddleSignals.channelId, id), eq(huddleSignals.toUserId, user.id)),
    )
    .orderBy(huddleSignals.createdAt);
  if (inbound.length > 0) {
    await db.delete(huddleSignals).where(
      inArray(
        huddleSignals.id,
        inbound.map((s) => s.id),
      ),
    );
  }

  return NextResponse.json({
    participants: await getActiveParticipants(id),
    signals: inbound.map((s) => ({ from: s.fromUserId, data: s.payload })),
  });
}
