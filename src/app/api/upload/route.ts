import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

// Las funciones de Vercel aceptan cuerpos de hasta ~4,5 MB.
const MAX_SIZE = 4 * 1024 * 1024;

// Detectado en el primer intento y recordado mientras viva la instancia.
let storeIsPrivate: boolean | null = null;

/**
 * Sube al Blob store respetando su modo:
 * - Privado (recomendado): el archivo se sirve por /api/files/..., que exige sesión.
 * - Público: se guarda la URL directa del blob.
 */
async function uploadBlob(path: string, file: File): Promise<string> {
  if (storeIsPrivate !== false) {
    try {
      const blob = await put(path, file, { access: "private" });
      storeIsPrivate = true;
      return `/api/files/${blob.pathname.split("/").map(encodeURIComponent).join("/")}`;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // Solo degradar a público si el error es por el modo del store.
      if (storeIsPrivate === true || !/access|public|private/i.test(message)) {
        throw e;
      }
      storeIsPrivate = false;
    }
  }
  const blob = await put(path, file, { access: "public" });
  return blob.url;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Falta configurar BLOB_READ_WRITE_TOKEN (Vercel Blob)." },
      { status: 500 },
    );
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 4 MB." },
      { status: 413 },
    );
  }

  const safeName = file.name.replace(/[^\w.\-áéíóúñü ]/gi, "").slice(0, 80) || "archivo";
  try {
    const url = await uploadBlob(`uploads/${nanoid(10)}-${safeName}`, file);
    return NextResponse.json({ url, name: file.name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo subir el archivo." },
      { status: 500 },
    );
  }
}
