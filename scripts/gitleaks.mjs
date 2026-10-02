#!/usr/bin/env node
// Busca secretos con gitleaks desde su imagen Docker (SPEC §9.3), sin instalar nada más.
// Uso:
//   node scripts/gitleaks.mjs --staged        lo que está por commitearse (hook de pre-commit)
//   node scripts/gitleaks.mjs --range A..B    los commits de un rango (CI)
//   node scripts/gitleaks.mjs --all           todo el historial (antes de hacer público el repo)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = "zricethezav/gitleaks:v8.30.1";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const [mode, value] = process.argv.slice(2);
const scan = {
  "--staged": ["git", "--staged"],
  "--range": ["git", `--log-opts=${value}`],
  "--all": ["git"],
}[mode ?? ""];

if (!scan || (mode === "--range" && !value)) {
  console.error("Uso: node scripts/gitleaks.mjs --staged | --range <desde..hasta> | --all");
  process.exit(2);
}

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${root}:/repo`,
    "-w",
    "/repo",
    // Dentro del contenedor el repo pertenece a otro usuario: sin esto, git lo rechaza ("dubious ownership")
    "-e",
    "GIT_CONFIG_COUNT=1",
    "-e",
    "GIT_CONFIG_KEY_0=safe.directory",
    "-e",
    "GIT_CONFIG_VALUE_0=*",
    IMAGE,
    ...scan,
    "--redact",
    "--no-banner",
    "--exit-code",
    "1",
    ".",
  ],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`No se pudo ejecutar Docker: ${result.error.message}. Ver: npm run doctor`);
  process.exit(2);
}
process.exit(result.status ?? 1);
