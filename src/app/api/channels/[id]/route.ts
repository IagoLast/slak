import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { getSessionUser } from "@/lib/session";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const channel = await getAccessibleChannel(user, id);
  if (!channel)
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  if (
    channel.type === "dm" ||
    user.role === "guest" ||
    (user.role !== "admin" && channel.createdBy !== user.id)
  ) {
    return NextResponse.json(
      { error: "Solo el creador o un administrador pueden borrar el canal." },
      { status: 403 },
    );
  }
  await db.delete(channels).where(eq(channels.id, id));
  return NextResponse.json({ deleted: true });
}
