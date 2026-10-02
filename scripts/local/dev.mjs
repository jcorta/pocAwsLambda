#!/usr/bin/env node
// `pnpm dev`: frontend en http://localhost:3000 con recarga en caliente. `next dev` corre en :3001 detrás
// del proxy del mismo origen, que reenvía Cognito a Floci (hallazgo A8).
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { startProxy } from "./web-proxy.mjs";

const NEXT_PORT = 3001;

const next = spawn(
  process.execPath,
  [join("node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(NEXT_PORT)],
  {
    cwd: join(ROOT, "apps", "web"),
    stdio: "inherit",
  },
);
next.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => next.kill(signal));

await startProxy({ port: 3000, target: `http://localhost:${NEXT_PORT}` });
console.log("\nAbrí http://localhost:3000 (no el :3001: sin el proxy, el login con Cognito falla por CORS)\n");
