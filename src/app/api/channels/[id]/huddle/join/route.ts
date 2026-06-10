import { NextResponse } from "next/server";
import { db } from "@/db";
import { huddleParticipants } from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { cleanupStale, getActiveParticipants } from "@/lib/huddle";
import { getSessionUser } from "@/lib/session";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  await cleanupStale(id);
  await db
    .insert(huddleParticipants)
    .values({ channelId: id, userId: user.id })
    .onConflictDoUpdate({
      target: [huddleParticipants.channelId, huddleParticipants.userId],
      set: { lastSeenAt: new Date() },
    });

  return NextResponse.json({ participants: await getActiveParticipants(id) });
}
