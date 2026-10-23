import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { openWorktreeChat } from "@/lib/worktree-chat";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = z
    .object({
      machineId: z.string().min(1).max(200),
      worktree: z.string().min(1).max(1000),
      runtimeId: z.string().max(200).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Worktree no válido" }, { status: 400 });
  try {
    return NextResponse.json(
      await openWorktreeChat(
        user,
        parsed.data.machineId,
        parsed.data.worktree,
        parsed.data.runtimeId,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 409 },
    );
  }
}
