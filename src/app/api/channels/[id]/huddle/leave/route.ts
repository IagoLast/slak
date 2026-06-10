import { NextResponse } from "next/server";
import { removeParticipant } from "@/lib/huddle";
import { getSessionUser } from "@/lib/session";

// También lo invoca navigator.sendBeacon al cerrar la pestaña,
// por eso no exige cuerpo ni comprueba acceso al canal (solo borra lo propio).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  await removeParticipant(id, user.id);
  return NextResponse.json({ ok: true });
}
