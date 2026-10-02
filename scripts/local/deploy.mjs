#!/usr/bin/env node
// `pnpm deploy:local`: ciclo rápido después de cambiar el backend. Reconstruye, aplica Terraform y migra.
import { applyInfra, buildLambdas, migrate, writeWebConfig } from "./deploy-steps.mjs";
import { FLOCI_URL, fail, loadEnv } from "./lib.mjs";

try {
  await fetch(`${FLOCI_URL}/_floci/health`, { signal: AbortSignal.timeout(2_000) });
} catch {
  fail("Floci no está levantado. Ejecutar primero: pnpm local:up");
}

buildLambdas();
const outputs = applyInfra();
await migrate(outputs);
writeWebConfig(outputs, loadEnv());
console.log("\n✔ Backend desplegado en Floci");
