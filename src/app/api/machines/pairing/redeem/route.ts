import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema } from "@/db/setup";
import {
  inspectMachinePairing,
  PairingError,
  redeemMachinePairing,
} from "@/lib/machine-pairing";

export async function GET(req: Request) {
  const code = req.headers
    .get("authorization")
    ?.match(/^Bearer (slak_pair_[a-f0-9]{64})$/)?.[1];
  if (!code)
    return NextResponse.json(
      { error: "Código de conexión no válido." },
      { status: 401 },
    );
  await ensureSchema();
  try {
    return NextResponse.json(await inspectMachinePairing(code), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PairingError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}

export async function POST(req: Request) {
  const code = req.headers
    .get("authorization")
    ?.match(/^Bearer (slak_pair_[a-f0-9]{64})$/)?.[1];
  if (!code)
    return NextResponse.json(
      { error: "Código de conexión no válido." },
      { status: 401 },
    );
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Nombre de máquina no válido." },
      { status: 400 },
    );
  await ensureSchema();
  try {
    const result = await redeemMachinePairing(code, parsed.data.name);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PairingError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
