import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json(
    { error: "Abre una sesión desde su worktree en la barra lateral." },
    { status: 410 },
  );
}
export { retired as GET, retired as POST };
