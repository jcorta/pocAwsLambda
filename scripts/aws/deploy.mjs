#!/usr/bin/env node
// `pnpm aws:deploy`: deploy manual en AWS desde la máquina del desarrollador (SPEC §11.1). Idempotente.
//   1. Bootstrap (bucket del state y rol OIDC), si falta.
//   2. Build de las Lambdas y del sitio.
//   3. terraform plan en infra/envs/aws, confirmación y apply del plan.
//   4. Migraciones, publicación del sitio y smoke tests.
// Los cambios posteriores pueden ir por deploy-aws.yml; este comando también sirve para re-desplegar a mano.
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLambdas, buildWeb, invokeMigrator } from "../local/deploy-steps.mjs";
import { fail, info, node, ROOT, step } from "../local/lib.mjs";
import { syncDir } from "../s3-sync.mjs";
import { BOOTSTRAP_DIR, confirm, ENV_DIR, loadCredentials, outputs, terraform } from "./lib.mjs";

const started = Date.now();

step("Credenciales de AWS");
loadCredentials();
const region = process.env["AWS_REGION"];

if (!existsSync(join(ROOT, ENV_DIR, "terraform.tfvars"))) {
  fail(
    `Falta ${ENV_DIR}/terraform.tfvars. Copiar ${ENV_DIR}/terraform.tfvars.example y completar ses_from con tu email.`,
  );
}

step("Bootstrap: bucket del state y rol OIDC (infra/bootstrap)");
terraform(BOOTSTRAP_DIR, ["init", "-input=false", "-no-color"], { capture: true });
terraform(BOOTSTRAP_DIR, ["apply", "-auto-approve", "-input=false", "-no-color", "-compact-warnings"]);
const boot = outputs(BOOTSTRAP_DIR);
writeFileSync(join(ROOT, ENV_DIR, "backend.hcl"), `bucket = "${boot.state_bucket}"\nregion = "${boot.region}"\n`);
info(`State en s3://${boot.state_bucket}`);

buildLambdas();
buildWeb();

step("Terraform plan en infra/envs/aws");
terraform(ENV_DIR, ["init", "-input=false", "-no-color", "-backend-config=backend.hcl", "-reconfigure"], {
  capture: true,
});
terraform(ENV_DIR, ["plan", "-input=false", "-no-color", "-compact-warnings", "-out=aws.tfplan"]);

const ok = await confirm(
  "¿Aplicar este plan en AWS? La primera vez tarda ~15 min (RDS y CloudFront) y genera costos por hora hasta `pnpm aws:destroy`.",
  "aplicar",
);
if (!ok) fail("Cancelado: no se aplicó nada.");

step("Terraform apply");
terraform(ENV_DIR, ["apply", "-input=false", "-no-color", "-compact-warnings", "aws.tfplan"]);
const out = outputs(ENV_DIR);

step("Migraciones (Lambda migrator)");
info(`${await invokeMigrator(out.migrator_function_name, new LambdaClient({ region }))} migraciones aplicadas`);

step(`Publicando el sitio en s3://${out.frontend_bucket}`);
const { uploaded, deleted } = await syncDir({
  s3: new S3Client({ region }),
  bucket: out.frontend_bucket,
  dir: join(ROOT, "apps", "web", "out"),
});
info(`${uploaded} archivos subidos${deleted ? `, ${deleted} viejos borrados` : ""}`);

step("Smoke tests");
const outputsFile = join(mkdtempSync(join(tmpdir(), "reservas-")), "outputs.json");
writeFileSync(outputsFile, JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { value: v }]))));
node("scripts/aws/smoke.mjs", [outputsFile]);

const minutes = Math.round((Date.now() - started) / 60_000);
console.log(`
✔ Desplegado en AWS en ${minutes} min

  Sitio        ${out.frontend_url}
  API          ${out.api_url}
  Remitente    revisá tu bandeja: AWS manda un link para verificar el remitente de SES (una sola vez)

  Siguiente:   registrate en el sitio  ·  pnpm aws:admin <tu-email> (para ser admin)
  Al terminar: pnpm aws:destroy  (borra todo, también el bootstrap; hasta entonces se cobra por hora)
`);
