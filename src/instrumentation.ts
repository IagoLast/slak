/**
 * Se ejecuta al arrancar el servidor (también en cada cold start de Vercel):
 * aplica las migraciones pendientes para que un deploy nuevo nunca corra
 * contra un esquema viejo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("@/db/setup");
    await ensureSchema().catch((e) => {
      console.error("No se pudo asegurar el esquema de la base de datos:", e);
    });
  }
}
