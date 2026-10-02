#!/usr/bin/env node
// `pnpm local:up [--ui]`: levanta todo el entorno local de punta a punta (SPEC §10.1). Idempotente.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyInfra, buildLambdas, migrate, writeWebConfig } from "./deploy-steps.mjs";
import { compose, info, loadEnv, node, removeTerraformFiles, ROOT, run, step, TF_DIR, waitForFloci } from "./lib.mjs";
import { seed } from "./seed.mjs";

const withUi = process.argv.includes("--ui");
const started = Date.now();

step("Prerequisitos (npm run doctor)");
node("scripts/doctor.mjs");

const env = loadEnv();

step(`Floci${withUi ? " y Floci UI" : ""}`);
compose([...(withUi ? ["--profile", "ui"] : []), "up", "-d", "floci", ...(withUi ? ["floci-ui"] : [])]);
await waitForFloci();

// Floci es efímero (SPEC §7.7): si el contenedor arrancó de nuevo, el state de Terraform ya no corresponde
const containerId = compose(["ps", "-q", "floci"], { capture: true }).stdout;
const startedAt = run("docker", ["inspect", "-f", "{{.State.StartedAt}}", containerId], { capture: true }).stdout;
const marker = join(ROOT, TF_DIR, ".floci-started-at");
const previous = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
if (previous !== startedAt) {
  removeTerraformFiles([`${TF_DIR}/terraform.tfstate`, `${TF_DIR}/terraform.tfstate.backup`]);
  if (previous) info("Floci se reinició: se descartó el state local de Terraform");
  writeFileSync(marker, `${startedAt}\n`);
}

buildLambdas();
const outputs = applyInfra();
await migrate(outputs);
await seed(outputs, env);
writeWebConfig(outputs, env);

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`
✔ Entorno local listo en ${seconds} s

  API          ${outputs.api_url}
  Floci        http://localhost:4566${withUi ? "\n  Floci UI     http://localhost:4500  (incluye la bandeja de emails de SES)" : ""}
  Postgres     localhost:${outputs.db_port}  (credenciales en el secreto ${outputs.db_secret_arn})

  Admin        ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}
  Usuario      ${env.SEED_USER_EMAIL} / ${env.SEED_USER_PASSWORD}

  Siguiente:   pnpm dev (frontend)  ·  pnpm deploy:local (tras cambiar el backend)  ·  pnpm local:logs [lambda]
`);
