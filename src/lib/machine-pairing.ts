import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { machinePairings, machines, users } from "@/db/schema";
import { hashToken, newAgentToken } from "@/lib/agents";
import type { SessionUser } from "@/lib/session";

export class PairingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function createMachinePairing(
  user: SessionUser,
  machineId?: string,
) {
  if (user.role === "guest")
    throw new PairingError("Solo los miembros pueden conectar máquinas.", 403);
  if (machineId) {
    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, machineId),
    });
    if (!machine || (machine.ownerId !== user.id && user.role !== "admin"))
      throw new PairingError("Sin permiso para conectar esta máquina.", 403);
  }
  const code = `slak_pair_${randomBytes(32).toString("hex")}`;
  const id = nanoid();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db.transaction(async (tx) => {
    // A fresh command replaces this user's unused commands for the same machine.
    await tx
      .delete(machinePairings)
      .where(
        and(
          eq(machinePairings.ownerId, user.id),
          isNull(machinePairings.consumedAt),
          machineId
            ? eq(machinePairings.machineId, machineId)
            : isNull(machinePairings.machineId),
        ),
      );
    await tx.insert(machinePairings).values({
      id,
      ownerId: user.id,
      machineId,
      tokenHash: hashToken(code),
      expiresAt,
    });
  });
  return { id, code, expiresAt };
}

export async function redeemMachinePairing(code: string, name: string) {
  return db.transaction(async (tx) => {
    // Lock before checking consumption: concurrent installers cannot both redeem.
    const [pairing] = await tx
      .select()
      .from(machinePairings)
      .where(eq(machinePairings.tokenHash, hashToken(code)))
      .for("update");
    if (
      !pairing ||
      pairing.consumedAt ||
      pairing.expiresAt.getTime() <= Date.now()
    )
      throw new PairingError(
        "Este comando ha caducado o ya se usó. Genera otro en Slak.",
        410,
      );
    const owner = await tx.query.users.findFirst({
      where: eq(users.id, pairing.ownerId),
    });
    if (!owner || owner.kind !== "human" || owner.role === "guest")
      throw new PairingError(
        "Ya no tienes permiso para conectar máquinas.",
        403,
      );
    const { token, tokenHash } = newAgentToken();
    const id = pairing.machineId ?? nanoid();
    if (pairing.machineId) {
      const [machine] = await tx
        .select()
        .from(machines)
        .where(eq(machines.id, id))
        .for("update");
      if (!machine || (machine.ownerId !== owner.id && owner.role !== "admin"))
        throw new PairingError(
          "Ya no tienes permiso para conectar esta máquina.",
          403,
        );
      await tx
        .update(machines)
        .set({ tokenHash, lastSeenAt: null })
        .where(eq(machines.id, id));
    } else {
      await tx
        .insert(machines)
        .values({ id, ownerId: owner.id, name, tokenHash });
    }
    await tx
      .update(machinePairings)
      .set({ machineId: id, consumedAt: new Date() })
      .where(eq(machinePairings.id, pairing.id));
    return { id, token };
  });
}

export async function inspectMachinePairing(code: string) {
  const pairing = await db.query.machinePairings.findFirst({
    where: eq(machinePairings.tokenHash, hashToken(code)),
  });
  if (
    !pairing ||
    pairing.consumedAt ||
    pairing.expiresAt.getTime() <= Date.now()
  )
    throw new PairingError(
      "Este comando ha caducado o ya se usó. Genera otro en Slak.",
      410,
    );
  return { machineId: pairing.machineId };
}
