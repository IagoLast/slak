import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { machinePairings, machines } from "@/db/schema";
import { createMachinePairing, PairingError } from "@/lib/machine-pairing";
import { getSessionUser } from "@/lib/session";

const headers = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = z
    .object({ machineId: z.string().min(1).max(100).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Máquina no válida." }, { status: 400 });
  try {
    return NextResponse.json(
      await createMachinePairing(user, parsed.data.machineId),
      { status: 201, headers },
    );
  } catch (error) {
    if (error instanceof PairingError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers },
      );
    throw error;
  }
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const pairing = await db.query.machinePairings.findFirst({
    where: and(
      eq(machinePairings.id, id),
      eq(machinePairings.ownerId, user.id),
    ),
  });
  if (!pairing)
    return NextResponse.json(
      { error: "Genera un nuevo comando para conectar." },
      { status: 404, headers },
    );
  const machine =
    pairing.consumedAt && pairing.machineId
      ? await db.query.machines.findFirst({
          where: eq(machines.id, pairing.machineId),
        })
      : null;
  return NextResponse.json(
    {
      status:
        machine?.tokenHash &&
        machine.lastSeenAt &&
        machine.lastSeenAt.getTime() > Date.now() - 60_000
          ? "connected"
          : pairing.consumedAt
            ? "starting"
            : pairing.expiresAt.getTime() <= Date.now()
              ? "expired"
              : "waiting",
      stalled:
        !!pairing.consumedAt &&
        pairing.consumedAt.getTime() < Date.now() - 90_000,
      machine: machine ? { id: machine.id, name: machine.name } : null,
    },
    { headers },
  );
}
