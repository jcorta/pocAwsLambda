#!/usr/bin/env node
// `pnpm deploy:web:local`: build estático del frontend y sincronización con el bucket de Floci (SPEC §10.1).
import { S3Client } from "@aws-sdk/client-s3";
import { join } from "node:path";
import { syncDir } from "../s3-sync.mjs";
import { buildWeb } from "./deploy-steps.mjs";
import { AWS, fail, FLOCI_URL, info, ROOT, step, terraformOutputs } from "./lib.mjs";

try {
  await fetch(`${FLOCI_URL}/_floci/health`, { signal: AbortSignal.timeout(2_000) });
} catch {
  fail("Floci no está levantado. Ejecutar primero: pnpm local:up");
}

buildWeb();

const outputs = terraformOutputs();
const bucket = outputs.frontend_bucket;
if (!bucket) fail("Falta el output frontend_bucket: ¿se aplicó el módulo frontend? Ejecutar pnpm local:up");

step(`Sincronizando apps/web/out con s3://${bucket}`);
const { uploaded, deleted } = await syncDir({
  s3: new S3Client({ ...AWS, forcePathStyle: true }),
  bucket,
  dir: join(ROOT, "apps", "web", "out"),
});
info(`${uploaded} archivos subidos${deleted ? `, ${deleted} viejos borrados` : ""}`);

console.log(`\n✔ Sitio publicado en ${outputs.frontend_url}`);
