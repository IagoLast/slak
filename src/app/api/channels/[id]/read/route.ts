import { NextResponse } from "next/server";
import { getAccessibleChannel, markChannelRead } from "@/lib/channels";
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

  await markChannelRead(user.id, id);
  return NextResponse.json({ ok: true });
}
