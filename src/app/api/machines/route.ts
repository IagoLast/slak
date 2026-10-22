import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { machines, users } from "@/db/schema";
import { newAgentToken } from "@/lib/agents";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const rows = await db
    .select({
      id: machines.id,
      name: machines.name,
      ownerId: machines.ownerId,
      ownerName: users.name,
      repositories: machines.repositories,
      sessions: machines.sessions,
      lastSeenAt: machines.lastSeenAt,
      tokenHash: machines.tokenHash,
    })
    .from(machines)
    .innerJoin(users, eq(users.id, machines.ownerId))
    .orderBy(asc(machines.name));
  return NextResponse.json({
    machines: rows.map(({ lastSeenAt, tokenHash, ...machine }) => ({
      ...machine,
      enabled: !!tokenHash,
      online:
        !!tokenHash &&
        !!lastSeenAt &&
        lastSeenAt.getTime() > Date.now() - 60_000,
    })),
  });
}
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (user.role === "guest")
    return NextResponse.json(
      { error: "Solo los miembros pueden compartir máquinas." },
      { status: 403 },
    );
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Escribe un nombre para tu máquina." },
      { status: 400 },
    );
  const id = nanoid(),
    { token, tokenHash } = newAgentToken();
  await db
    .insert(machines)
    .values({ id, name: parsed.data.name, ownerId: user.id, tokenHash });
  return NextResponse.json(
    { id, token },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
