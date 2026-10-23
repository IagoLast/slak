import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { agents, machines, machineCommands, users } from "@/db/schema";
import { newAgentToken } from "@/lib/agents";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const owner = alias(users, "owner");
  const rows = await db
    .select({
      id: agents.id,
      name: users.name,
      handle: agents.handle,
      mode: agents.mode,
      description: agents.description,
      machine: agents.machine,
      machineId: agents.machineId,
      worktree: agents.worktree,
      repository: agents.repository,
      provider: agents.provider,
      state: agents.state,
      error: agents.error,
      ownerName: owner.name,
      lastSeenAt: agents.lastSeenAt,
      machineSeenAt: machines.lastSeenAt,
      machineToken: machines.tokenHash,
      tokenHash: agents.tokenHash,
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.id))
    .innerJoin(owner, eq(owner.id, agents.createdBy))
    .leftJoin(machines, eq(machines.id, agents.machineId))
    .orderBy(asc(users.name));
  return NextResponse.json({
    agents: rows.map(
      ({ tokenHash, lastSeenAt, machineSeenAt, machineToken, ...agent }) => {
        const enabled = agent.machineId ? !!machineToken : !!tokenHash;
        const seen = agent.machineId ? machineSeenAt : lastSeenAt;
        return {
          ...agent,
          enabled,
          online:
            enabled &&
            !!seen &&
            seen.getTime() > Date.now() - 60_000 &&
            ["external", "ready"].includes(agent.state),
        };
      },
    ),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  mode: z.enum(["session", "orchestrator"]).default("session"),
  description: z.string().trim().max(500).default(""),
  machine: z.string().trim().max(100).default(""),
  machineId: z.string().optional(),
  repository: z.string().max(500).default(""),
  provider: z.enum(["codex", "claude"]).default("codex"),
  worktree: z.string().max(500).default(""),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "guest")
    return NextResponse.json(
      { error: "Solo los miembros pueden crear agentes." },
      { status: 403 },
    );
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Revisa el nombre y el alias (2–40 letras minúsculas, números, guiones).",
      },
      { status: 400 },
    );
  const { name, ...profile } = parsed.data;
  if (
    profile.mode === "orchestrator" &&
    (!profile.machineId || profile.worktree)
  )
    return NextResponse.json(
      { error: "Elige una máquina y un proyecto para el bot." },
      { status: 400 },
    );
  const machine = profile.machineId
    ? await db.query.machines.findFirst({
        where: eq(machines.id, profile.machineId),
      })
    : null;
  const session =
    machine && profile.worktree
      ? machine.sessions.find((s) => s.worktree === profile.worktree)
      : null;
  if (machine && profile.worktree && !session)
    return NextResponse.json(
      { error: "Esa sesión ya no está compartida. Actualiza la lista." },
      { status: 409 },
    );
  if (
    profile.machineId &&
    (!machine?.tokenHash ||
      !machine.repositories.some((r) => r.id === profile.repository))
  ) {
    return NextResponse.json(
      { error: "Selecciona un proyecto compartido por esta máquina." },
      { status: 400 },
    );
  }
  if (
    machine &&
    (!machine.lastSeenAt || machine.lastSeenAt.getTime() < Date.now() - 60_000)
  ) {
    return NextResponse.json(
      { error: "La máquina está desconectada." },
      { status: 409 },
    );
  }
  const id = nanoid();
  const { token, tokenHash } = newAgentToken();
  try {
    await db.transaction(async (tx) => {
      if (machine && profile.mode === "orchestrator") {
        await tx
          .select({ id: machines.id })
          .from(machines)
          .where(eq(machines.id, machine.id))
          .for("update");
        const [parent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.machineId, machine.id),
              eq(agents.repository, profile.repository),
              eq(agents.mode, "orchestrator"),
            ),
          );
        if (parent) throw new Error("PROJECT_PARENT_EXISTS");
      }
      await tx.insert(users).values({
        id,
        name,
        email: `${id}@agents.slak.invalid`,
        passwordHash: "disabled",
        kind: "agent",
        role: "guest",
        lastSeenAt: new Date(0),
      });
      await tx.insert(agents).values({
        id,
        ...profile,
        machine: machine?.name ?? profile.machine,
        worktree: session?.worktree ?? (machine ? "" : profile.worktree),
        runtimeHandle: session?.runtimeHandle,
        provider: session?.provider ?? profile.provider,
        state:
          session || profile.mode === "orchestrator"
            ? "ready"
            : machine
              ? "starting"
              : "external",
        tokenHash: machine ? null : tokenHash,
        createdBy: user.id,
      });
      if (machine && !session && profile.mode !== "orchestrator")
        await tx.insert(machineCommands).values({
          id: nanoid(),
          machineId: machine.id,
          agentId: id,
          action: "create",
        });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_PARENT_EXISTS")
      return NextResponse.json(
        {
          error:
            "Este proyecto ya tiene un agente padre en esa máquina. Ábrelo desde la barra lateral.",
        },
        { status: 409 },
      );
    const cause = error as { cause?: { code?: string }; code?: string };
    if (cause.code === "23505" || cause.cause?.code === "23505")
      return NextResponse.json(
        { error: "Ese alias ya está en uso." },
        { status: 409 },
      );
    throw error;
  }
  return NextResponse.json(
    { id, token: machine ? null : token },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
