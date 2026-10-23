import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSchema } from "@/db/setup";
import { channelMembers, channels, invites, users } from "@/db/schema";

/**
 * Registro de usuarios:
 * - Sin token: solo funciona si no existe ningún usuario (crea el admin y #general).
 * - Con token: consume una invitación y crea el usuario con el rol indicado.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "")
    .toLowerCase()
    .trim();
  const password = String(body?.password ?? "");
  const token = body?.token ? String(body.token) : null;

  if (!name || !email || password.length < 8) {
    return NextResponse.json(
      {
        error:
          "Nombre, email y contraseña (mínimo 8 caracteres) son obligatorios.",
      },
      { status: 400 },
    );
  }

  try {
    await ensureSchema();
  } catch (error) {
    console.error(
      "No se pudo preparar la base de datos para el registro:",
      error,
    );
    return NextResponse.json(
      {
        error:
          "No se pudo preparar el registro. Inténtalo de nuevo en unos segundos.",
      },
      { status: 503 },
    );
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe una cuenta con ese email." },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = nanoid();

  if (token) {
    return db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invites)
        .where(eq(invites.token, token))
        .for("update");
      if (!invite || invite.usedAt) {
        return NextResponse.json(
          { error: "La invitación no es válida o ya se ha usado." },
          { status: 400 },
        );
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return NextResponse.json(
          { error: "Esta invitación es para otro email." },
          { status: 400 },
        );
      }

      await tx.insert(users).values({
        id: userId,
        email,
        name,
        passwordHash,
        role: invite.role,
      });
      if (invite.channelIds.length > 0) {
        await tx
          .insert(channelMembers)
          .values(invite.channelIds.map((channelId) => ({ channelId, userId })))
          .onConflictDoNothing();
      }
      await tx
        .update(invites)
        .set({ usedAt: new Date() })
        .where(eq(invites.token, token));

      return NextResponse.json({ ok: true });
    });
  }

  // Primer usuario de la instancia: se convierte en admin y se crea #general.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if (count > 0) {
    return NextResponse.json(
      {
        error:
          "El registro es solo con invitación. Pide un enlace a un administrador.",
      },
      { status: 403 },
    );
  }

  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash,
    role: "admin",
  });
  const generalId = nanoid();
  await db.insert(channels).values({
    id: generalId,
    name: "general",
    description: "Canal general de la empresa",
    type: "public",
    createdBy: userId,
  });
  await db.insert(channelMembers).values({ channelId: generalId, userId });

  return NextResponse.json({ ok: true });
}
