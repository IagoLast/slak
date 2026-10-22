import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { newAgentToken } from "@/lib/agents";
import { getSessionUser } from "@/lib/session";

async function changeToken(req: Request, params: Promise<{ id: string }>) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (
    !agent ||
    (user.role !== "admin" && agent.createdBy !== user.id) ||
    agent.machineId
  )
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const next =
    req.method === "DELETE"
      ? { token: null, tokenHash: null }
      : newAgentToken();
  const changed = await db
    .update(agents)
    .set({ tokenHash: next.tokenHash, lastSeenAt: null })
    .where(eq(agents.id, id))
    .returning({ id: agents.id });
  if (!changed.length)
    return NextResponse.json(
      { error: "Agente no encontrado" },
      { status: 404 },
    );
  return NextResponse.json(
    { token: next.token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return changeToken(req, params);
}
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return changeToken(req, params);
}
