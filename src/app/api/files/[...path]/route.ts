import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

/**
 * Sirve archivos de un Blob store privado exigiendo sesión.
 * Los mensajes guardan /api/files/<pathname> como URL del adjunto.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { path } = await params;
  const pathname = path.map(decodeURIComponent).join("/");
  if (!pathname.startsWith("uploads/")) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": result.blob.contentDisposition,
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
}
