import { NextResponse } from "next/server";
import { ensureSchema } from "@/db/setup";

/**
 * Fuerza la creación/actualización del esquema. Normalmente no hace falta:
 * la app se auto-migra al arrancar (src/instrumentation.ts), pero esta URL
 * queda como botón de emergencia. Es idempotente y no toca datos.
 */
export async function GET() {
  try {
    await ensureSchema(true);
    return NextResponse.json({
      ok: true,
      message: "Esquema al día. Ya puedes usar la app.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Error desconocido",
        hint: "Comprueba que DATABASE_URL o POSTGRES_URL está configurada en Vercel.",
      },
      { status: 500 },
    );
  }
}
