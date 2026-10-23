import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import packageJson from "../../../../../package.json";

export const runtime = "nodejs";

// Only these public installer sources are served, never paths supplied by a request.
export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file");
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (file === "bundle") {
    const names = ["orca-bridge.mjs", "orca-work.mjs", "orca-native.mjs", "orca-transcript.mjs"];
    const entries = await Promise.all(
      names.map(async (name) => [
        name,
        await readFile(join(process.cwd(), "scripts", name), "utf8"),
      ]),
    );
    return NextResponse.json(
      {
        files: Object.fromEntries(entries),
        sdkVersion: packageJson.dependencies[
          "@modelcontextprotocol/sdk"
        ].replace(/^[~^]/, ""),
      },
      { headers },
    );
  }
  if (file && file !== "setup")
    return new Response("No encontrado", { status: 404, headers });
  const source = await readFile(
    join(
      process.cwd(),
      "scripts",
      file === "setup" ? "setup-machine.mjs" : "install-machine.sh",
    ),
    "utf8",
  );
  return new Response(source, {
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}
