import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

// Las funciones de Vercel aceptan cuerpos de hasta ~4,5 MB.
const MAX_SIZE = 4 * 1024 * 1024;

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
  const blob = await put(`uploads/${nanoid(10)}-${safeName}`, file, {
    access: "public",
  });

  return NextResponse.json({ url: blob.url, name: file.name });
}
