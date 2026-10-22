#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const docker = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
  stdio: "inherit",
});
if (docker.status !== 0) process.exit(docker.status ?? 1);
const port = process.env.PORT || "3000";
const child = spawn("npm", ["run", "dev", "--", "--port", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: "postgres://slak:slak_local@127.0.0.1:54329/slak",
    AUTH_SECRET: process.env.AUTH_SECRET || randomBytes(32).toString("hex"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
