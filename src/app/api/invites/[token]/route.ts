import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Solo administradores" },
      { status: 403 },
    );
  }
  const { token } = await params;
  const [revoked] = await db
    .delete(invites)
    .where(and(eq(invites.token, token), isNull(invites.usedAt)))
    .returning({ token: invites.token });
  if (!revoked) {
    return NextResponse.json(
      { error: "La invitación ya se usó o dejó de estar disponible." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
