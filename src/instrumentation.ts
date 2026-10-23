/**
 * Se ejecuta al arrancar el servidor (también en cada cold start de Vercel):
 * adelanta las migraciones pendientes. Las entradas de registro, autenticación
 * y MCP también esperan ensureSchema(): no dependen del arranque en segundo plano
 * de las funciones de Vercel para garantizar que el esquema esté listo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("@/db/setup");
    await ensureSchema().catch((e) => {
      console.error("No se pudo asegurar el esquema de la base de datos:", e);
    });
  }
}
