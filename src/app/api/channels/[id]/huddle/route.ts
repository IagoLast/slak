import { NextResponse } from "next/server";
import { getAccessibleChannel } from "@/lib/channels";
import { getActiveParticipants } from "@/lib/huddle";
import { getSessionUser } from "@/lib/session";

/** Estado del huddle del canal: quién está dentro ahora mismo. */
export async function GET(
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

  return NextResponse.json({ participants: await getActiveParticipants(id) });
}
