import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertConnectionStopped,
  selectRepositories,
  slakOrigin,
} from "../scripts/setup-machine.mjs";

test("project selection shares only the chosen projects, without needing Orca IDs", () => {
  const projects = [{ id: "one" }, { id: "two" }, { id: "three" }];
  assert.deepEqual(selectRepositories("3, 1,3", projects), [
    "id:three",
    "id:one",
  ]);
  assert.deepEqual(selectRepositories("todos", projects), [
    "id:one",
    "id:two",
    "id:three",
  ]);
  for (const input of ["", "0", "4", "1.5", "1abc", "1; rm -rf", "-1"])
    assert.throws(() => selectRepositories(input, projects));
});

test("installer refuses insecure remote servers and URL credentials", () => {
  assert.equal(
    slakOrigin("https://slak.example/machines"),
    "https://slak.example",
  );
  assert.equal(slakOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(slakOrigin("http://[::1]:3000"), "http://[::1]:3000");
  for (const url of [
    "http://slak.example",
    "file:///tmp/slak",
    "https://user:password@slak.example",
  ])
    assert.throws(() => slakOrigin(url));
});

test("reconnecting cannot overwrite credentials while the previous local bridge is alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slak-lock-test-"));
  const config = join(directory, "config.json");
  try {
    await assertConnectionStopped(config);
    await mkdir(`${config}.lock`);
    await writeFile(`${config}.lock/pid`, String(process.pid));
    await assert.rejects(
      () => assertConnectionStopped(config),
      /ya tiene una conexión abierta/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("downloaded entrypoints still run through symlinks, as in macOS temporary folders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slak-entry-test-"));
  try {
    const bridge = join(directory, "bridge.mjs");
    await symlink(fileURLToPath(new URL("../scripts/orca-bridge.mjs", import.meta.url)), bridge);
    const { stdout } = await promisify(execFile)(process.execPath, [bridge, "--help"]);
    assert.match(stdout, /Uso: npm run orca:bridge/);
    const setup = join(directory, "setup.mjs");
    await symlink(fileURLToPath(new URL("../scripts/setup-machine.mjs", import.meta.url)), setup);
    await assert.rejects(promisify(execFile)(process.execPath, [setup]), (error) => error.code === 1 && /Invalid URL/.test(error.stderr));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
