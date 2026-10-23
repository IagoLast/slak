import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureSchema } from "@/db/setup";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member" | "guest";
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  await ensureSchema();
  // El JWT identifica la sesión; los permisos actuales pertenecen al usuario.
  // Un cambio de rol debe aplicarse también a sesiones que ya estaban abiertas.
  const user = await db.query.users.findFirst({
    columns: { id: true, name: true, email: true, role: true, kind: true },
    where: eq(users.id, session.user.id),
  });
  if (!user || user.kind !== "human") return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
