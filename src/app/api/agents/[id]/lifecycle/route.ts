import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agents, machines, machineCommands } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "guest")
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const parsed = z
    .object({ action: z.enum(["start", "stop"]) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  const { id } = await params;
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!agent?.machineId)
    return NextResponse.json(
      { error: "Este agente no está gestionado por una máquina compartida." },
      { status: 400 },
    );
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, agent.machineId),
  });
  if (
    !machine?.tokenHash ||
    !machine.lastSeenAt ||
    machine.lastSeenAt.getTime() < Date.now() - 60_000
  )
    return NextResponse.json(
      { error: "La máquina debe estar conectada." },
      { status: 409 },
    );
  const { action } = parsed.data;
  if (
    (action === "start" && !["stopped", "error"].includes(agent.state)) ||
    (action === "stop" && !["ready", "error"].includes(agent.state))
  ) {
    return NextResponse.json(
      {
        error:
          "Ya hay una operación en curso o el agente ya está en ese estado.",
      },
      { status: 409 },
    );
  }
  const changed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(agents)
      .set({ state: action === "start" ? "starting" : "stopping", error: null })
      .where(and(eq(agents.id, id), eq(agents.state, agent.state)))
      .returning();
    if (!rows.length) return false;
    await tx
      .insert(machineCommands)
      .values({
        id: nanoid(),
        machineId: agent.machineId!,
        agentId: id,
        action: action === "start" && !agent.worktree ? "create" : action,
      });
    return true;
  });
  return NextResponse.json(
    changed ? { queued: true } : { error: "Ya hay otra operación en curso." },
    { status: changed ? 202 : 409 },
  );
}
