#!/usr/bin/env node
// Chequeos de Terraform en contenedores, sin Floci (SPEC §8.1):
//   `pnpm lint:infra`: fmt -check, validate de cada root y tflint.
//   `pnpm test:infra`: `terraform test` en cada módulo con tests (providers simulados).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compose, fail, ROOT, step } from "./local/lib.mjs";

const ROOTS = ["infra/envs/local", "infra/envs/aws", "infra/bootstrap"];
const MODULES = readdirSync(join(ROOT, "infra/modules")).map((m) => `infra/modules/${m}`);

/**
 * Terraform en su contenedor, sin levantar Floci (`--no-deps`). Usa su propio directorio de datos
 * (`.terraform-check/`): así no depende del `.terraform` de cada root, que `local:up` y `aws:deploy` dejan
 * inicializado con su backend (local o S3), y los chequeos funcionan sin credenciales ni state.
 */
const terraform = (dir, args) =>
  compose([
    "run",
    "--rm",
    "-T",
    "--no-deps",
    "-e",
    `TF_DATA_DIR=/work/.terraform-check/${dir.replaceAll("/", "_")}`,
    "terraform",
    `-chdir=${dir}`,
    ...args,
  ]);

// Solo descarga los providers: sin backend, así no toca el state del entorno local
const init = (dir) => terraform(dir, ["init", "-backend=false", "-input=false", "-no-color"]);

const mode = process.argv[2];

if (mode === "lint") {
  step("terraform fmt -check");
  compose(["run", "--rm", "-T", "--no-deps", "terraform", "fmt", "-check", "-recursive", "-diff"]);
  for (const dir of ROOTS) {
    step(`terraform validate: ${dir}`);
    init(dir);
    terraform(dir, ["validate", "-no-color"]);
  }
  step("tflint");
  compose(["run", "--rm", "-T", "tflint", "--recursive", "--config", "/work/.tflint.hcl", "--no-color"]);
} else if (mode === "test") {
  const withTests = [...MODULES, ...ROOTS].filter((dir) => existsSync(join(ROOT, dir, "tests")));
  for (const dir of withTests) {
    step(`terraform test: ${dir}`);
    init(dir);
    terraform(dir, ["test", "-no-color"]);
  }
} else {
  fail("Uso: node scripts/infra.mjs lint|test");
}
