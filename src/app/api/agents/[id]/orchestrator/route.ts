import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { agents, agentTasks, machineCommands, machines } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

/** Reuse the mention identity, preserving its legacy terminal and history. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user || user.role === "guest")
    return NextResponse.json(
      { error: "Solo los miembros pueden activar orquestadores." },
      { status: 403 },
    );
  const { id } = await params;
  try {
    await db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(agents)
        .where(eq(agents.id, id))
        .for("update");
      if (!agent?.machineId)
        throw new Error("Este agente necesita una máquina compartida.");
      if (agent.mode === "orchestrator") return;
      const [machine] = await tx
        .select()
        .from(machines)
        .where(eq(machines.id, agent.machineId));
      if (
        !machine?.tokenHash ||
        !machine.repositories.some((r) => r.id === agent.repository)
      )
        throw new Error("Conecta la máquina y comparte el proyecto primero.");
      const pending = await tx
        .select({ id: agentTasks.id })
        .from(agentTasks)
        .where(
          and(
            eq(agentTasks.agentId, id),
            inArray(agentTasks.status, ["queued", "running"]),
          ),
        );
      const commands = await tx
        .select({ id: machineCommands.id })
        .from(machineCommands)
        .where(
          and(
            eq(machineCommands.agentId, id),
            inArray(machineCommands.status, ["queued", "running"]),
          ),
        );
      if (pending.length || commands.length)
        throw new Error(
          "Espera a que termine el trabajo pendiente antes de cambiar esta identidad.",
        );
      await tx
        .update(agents)
        .set({ mode: "orchestrator", state: "ready", error: null })
        .where(eq(agents.id, id));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 409 },
    );
  }
}
