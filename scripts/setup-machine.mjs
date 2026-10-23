#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const exec = promisify(execFile);
const files = ["orca-bridge.mjs", "orca-work.mjs", "orca-native.mjs", "orca-transcript.mjs"];
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export function slakOrigin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Usa una dirección HTTPS de Slak; HTTP solo está permitido en localhost.",
    );
  return url.origin;
}

export function selectRepositories(answer, repositories) {
  const input = answer.trim().toLowerCase();
  if (input === "todos") return repositories.map((repo) => `id:${repo.id}`);
  const numbers = input.split(/[\s,]+/);
  if (
    !input ||
    numbers.some(
      (number) =>
        !/^\d+$/.test(number) ||
        Number(number) < 1 ||
        Number(number) > repositories.length,
    )
  )
    throw new Error(
      "Escribe los números de los proyectos (por ejemplo, 1,3) o «todos».",
    );
  return [
    ...new Set(
      numbers.map((number) => `id:${repositories[Number(number) - 1].id}`),
    ),
  ];
}

export async function assertConnectionStopped(configPath) {
  const pid = await readFile(`${configPath}.lock/pid`, "utf8").catch(
    (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!pid) return;
  try {
    process.kill(Number(pid), 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  throw new Error(
    "Esta máquina ya tiene una conexión abierta. Cierra su terminal anterior y vuelve a pegar el comando.",
  );
}

async function request(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(
      data?.error ?? `No se pudo contactar con Slak (${response.status}).`,
    );
  return data;
}

export async function setupMachine(originValue, code) {
  const origin = slakOrigin(originValue);
  if (!/^slak_pair_[a-f0-9]{64}$/.test(code ?? ""))
    throw new Error("Genera un nuevo comando desde Máquinas compartidas.");
  const root =
    process.env.SLAK_MACHINE_HOME || join(homedir(), ".slak", "machines");
  const pairing = await request(origin, "/api/machines/pairing/redeem", {
    headers: { Authorization: `Bearer ${code}` },
  });
  if (pairing.machineId)
    await assertConnectionStopped(join(root, pairing.machineId, "config.json"));
  const bin = process.env.SLAK_ORCA_BIN || "orca";
  let repositories;
  try {
    const { stdout } = await exec(bin, ["repo", "list", "--json"], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (!result.ok) throw new Error("Orca no está disponible.");
    repositories = result.result?.repos ?? [];
  } catch {
    throw new Error(
      "No se pudo leer tus proyectos. Abre Orca y vuelve a pegar el comando.",
    );
  }
  if (!repositories.length)
    throw new Error(
      "Añade al menos un proyecto a Orca y vuelve a pegar el comando.",
    );
  console.log("\n¿Qué proyectos quieres compartir con tu equipo?");
  repositories.forEach((repo, index) =>
    console.log(
      `  ${index + 1}. ${repo.displayName || repo.path.split("/").pop()}`,
    ),
  );
  console.log(
    "\nSolo se compartirán los proyectos que elijas y sus sesiones de Orca.",
  );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let repos;
  try {
    while (!repos) {
      const answer = await terminal.question(
        "Proyectos (números separados por comas, o «todos»): ",
      );
      try {
        repos = selectRepositories(answer, repositories);
      } catch (error) {
        console.log(error.message);
      }
    }
  } finally {
    terminal.close();
  }

  // The bridge is installed independently of the Slak source repository.
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, "connection-"));
  const bundle = await request(origin, "/api/machines/install?file=bundle");
  for (const file of files) {
    if (typeof bundle.files?.[file] !== "string")
      throw new Error(
        "El instalador está incompleto. Vuelve a intentarlo desde Slak.",
      );
    await writeFile(join(directory, file), bundle.files[file], { mode: 0o600 });
  }
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@modelcontextprotocol/sdk": bundle.sdkVersion },
    }),
    { mode: 0o600 },
  );
  console.log("\nInstalando la conexión…");
  await exec(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd: directory,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  ).catch(() => {
    throw new Error(
      "No se pudieron instalar las dependencias. Comprueba tu conexión a Internet y vuelve a intentarlo.",
    );
  });
  // Check compatibility before consuming the one-time code or replacing an existing connection.
  const { loadNativeRuntime } = await import(
    pathToFileURL(join(directory, "orca-native.mjs"))
  );
  await loadNativeRuntime();
  if (pairing.machineId)
    await assertConnectionStopped(join(root, pairing.machineId, "config.json"));
  const identity = await request(origin, "/api/machines/pairing/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${code}`,
    },
    body: JSON.stringify({ name: hostname().slice(0, 80) || "Mi máquina" }),
  });
  // Stable config paths preserve receipts and per-session credentials when reconnecting.
  const connectionDir = join(root, identity.id);
  await mkdir(connectionDir, { recursive: true, mode: 0o700 });
  const configPath = join(connectionDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ url: `${origin}/api/mcp`, token: identity.token, repos }),
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600);
  const bridgePath = join(directory, "orca-bridge.mjs");
  const startPath = join(connectionDir, "conectar.command");
  await writeFile(
    startPath,
    `#!/usr/bin/env bash\nexec ${quote(process.execPath)} ${quote(bridgePath)} --config ${quote(configPath)}\n`,
    { mode: 0o700 },
  );
  console.log("\nConectando… Slak confirmará cuando la máquina esté lista.");
  console.log(
    "Mantén esta terminal abierta mientras compartes. Ctrl+C detiene la conexión.",
  );
  console.log(`Para conectar de nuevo, abre: ${startPath}\n`);
  const child = spawn(process.execPath, [bridgePath, "--config", configPath], {
    stdio: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code
        ? reject(
            new Error(
              "La conexión se ha detenido. Revisa el mensaje anterior.",
            ),
          )
        : resolve(),
    );
  });
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === fileURLToPath(import.meta.url)
)
  setupMachine(process.argv[2], process.argv[3]).catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
