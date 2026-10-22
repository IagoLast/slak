import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines } from "@/db/schema";
import { newAgentToken } from "@/lib/agents";
import { getSessionUser } from "@/lib/session";
async function change(req: Request, params: Promise<{ id: string }>) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, id),
  });
  if (!machine || (machine.ownerId !== user.id && user.role !== "admin"))
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const next =
    req.method === "DELETE"
      ? { token: null, tokenHash: null }
      : newAgentToken();
  await db
    .update(machines)
    .set({ tokenHash: next.tokenHash, lastSeenAt: null })
    .where(eq(machines.id, id));
  return NextResponse.json(
    { token: next.token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(req, params);
}
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return change(req, params);
}
