#!/usr/bin/env node
// `pnpm aws:destroy`: borra todo lo del proyecto en AWS, en orden y sin dejar nada (SPEC §11.1).
//   1. terraform destroy de infra/envs/aws (antes desactiva la protección contra borrado de RDS).
//   2. Verifica que el state quedó vacío y que no queda ningún recurso con los tags del proyecto.
//   3. Recién entonces, destroy del bootstrap: el bucket del state y el rol OIDC.
// Si algo falla, se corta sin tocar el bootstrap: con el state intacto, volver a correrlo retoma donde quedó.
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildLambdas } from "../local/deploy-steps.mjs";
import { fail, info, removeTerraformFiles, ROOT, step } from "../local/lib.mjs";
import { BOOTSTRAP_DIR, confirm, ENV_DIR, inState, loadCredentials, terraform } from "./lib.mjs";

const keepBootstrap = process.argv.includes("--keep-bootstrap");

step("Credenciales de AWS");
const { account } = loadCredentials();

const ok = await confirm(
  `Se va a borrar el entorno de AWS de la cuenta ${account}${keepBootstrap ? "" : ", incluido el bootstrap (bucket del state y rol OIDC)"}.\n` +
    "  Los datos (reservas, usuarios) se pierden.",
  "borrar",
);
if (!ok) fail("Cancelado: no se borró nada.");

if (!existsSync(join(ROOT, BOOTSTRAP_DIR, "terraform.tfstate")) || !existsSync(join(ROOT, ENV_DIR, "backend.hcl"))) {
  fail(
    "No se encontró el state del bootstrap o envs/aws/backend.hcl: este comando tiene que correr en la misma " +
      "máquina que `pnpm aws:deploy`. Si se perdieron, ver los recursos con el tag project=reservas en la consola.",
  );
}

// El destroy evalúa el código de las Lambdas (archive_file): tiene que existir el build
buildLambdas();

terraform(ENV_DIR, ["init", "-input=false", "-no-color", "-backend-config=backend.hcl", "-reconfigure"], {
  capture: true,
});

// Un despliegue que falló a medias puede no tener RDS: con `-target`, Terraform la crearía en lugar de modificarla
const RDS = "module.database.aws_db_instance.main";
if (inState(terraform(ENV_DIR, ["state", "list"], { capture: true }).stdout, RDS)) {
  step("Terraform: preparar el borrado de RDS");
  // Con protección contra borrado (SPEC §7.3) RDS no se puede destruir: primero se desactiva, y eso además
  // omite el snapshot final, que quedaría cobrando
  terraform(ENV_DIR, [
    "apply",
    "-auto-approve",
    "-input=false",
    "-no-color",
    "-compact-warnings",
    `-target=${RDS}`,
    "-var=db_deletion_protection=false",
  ]);
} else {
  info("RDS no está en el state (despliegue incompleto): no hay protección que desactivar");
}

step("Terraform destroy en infra/envs/aws (CloudFront y la red pueden tardar ~15 min)");
terraform(ENV_DIR, [
  "destroy",
  "-auto-approve",
  "-input=false",
  "-no-color",
  "-compact-warnings",
  "-var=db_deletion_protection=false",
]);

step("Verificación: no queda nada del entorno");
const state = terraform(ENV_DIR, ["state", "list"], { capture: true }).stdout;
if (state) fail(`El state todavía tiene recursos; no se toca el bootstrap:\n${state}`);
info("State vacío");

// La API de tags puede tardar unos minutos en reflejar los borrados
const tagging = new ResourceGroupsTaggingAPIClient({ region: process.env["AWS_REGION"] });
let leftovers = [];
for (let attempt = 0; attempt < 12; attempt++) {
  leftovers = [];
  let PaginationToken;
  do {
    const page = await tagging.send(
      new GetResourcesCommand({
        TagFilters: [
          { Key: "project", Values: ["reservas"] },
          { Key: "env", Values: ["aws"] },
        ],
        PaginationToken,
      }),
    );
    leftovers.push(...(page.ResourceTagMappingList ?? []).map((r) => r.ResourceARN));
    PaginationToken = page.PaginationToken || undefined;
  } while (PaginationToken);
  if (leftovers.length === 0) break;
  info(`Quedan ${leftovers.length} recursos con tags del proyecto; reintento en 15 s`);
  await new Promise((r) => setTimeout(r, 15_000));
}
if (leftovers.length) {
  fail(
    `Siguen apareciendo recursos del proyecto; no se toca el bootstrap. Revisarlos y volver a correr:\n    ` +
      leftovers.join("\n    "),
  );
}
info("Ningún recurso con los tags project=reservas y env=aws");

if (keepBootstrap) {
  console.log("\n✔ Entorno borrado. El bootstrap queda (bucket del state y rol OIDC, ~0 USD).");
  process.exit(0);
}

step("Terraform destroy del bootstrap (bucket del state y rol OIDC)");
terraform(BOOTSTRAP_DIR, ["init", "-input=false", "-no-color"], { capture: true });
terraform(BOOTSTRAP_DIR, ["destroy", "-auto-approve", "-input=false", "-no-color", "-compact-warnings"]);

// Lo generado localmente ya no apunta a nada. Lo de Terraform se borra desde su contenedor (en Linux es de root)
removeTerraformFiles([
  `${BOOTSTRAP_DIR}/terraform.tfstate`,
  `${BOOTSTRAP_DIR}/terraform.tfstate.backup`,
  `${ENV_DIR}/.terraform`,
  `${ENV_DIR}/.build`,
  `${ENV_DIR}/aws.tfplan`,
]);
rmSync(join(ROOT, ENV_DIR, "backend.hcl"), { force: true });

console.log("\n✔ Todo borrado: en AWS no queda nada del proyecto.");
