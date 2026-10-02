#!/usr/bin/env node
// `pnpm local:down`  → detiene los contenedores.
// `pnpm local:reset` → además borra el state local de Terraform y lo generado por local:up (SPEC §10.1).
// En los dos casos se borran los volúmenes de Floci: guarda todo en memoria (SPEC §7.7), así que sin
// el contenedor no sirven, y los de RDS los crea Floci, por lo que `docker compose down -v` no los alcanza.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { compose, info, ROOT, run, step, TF_DIR } from "./lib.mjs";

const reset = process.argv.includes("--reset");

step("Deteniendo contenedores");
compose(["--profile", "ui", "down", "-v"]);

const volumes = run("docker", ["volume", "ls", "-q", "--filter", "label=floci=true"], { capture: true }).stdout;
for (const v of volumes.split(/\s+/).filter(Boolean)) {
  run("docker", ["volume", "rm", v], { capture: true });
  info(`volumen ${v} borrado`);
}

if (reset) {
  step("Borrando el state local y lo generado por local:up");
  for (const p of [
    join(TF_DIR, "terraform.tfstate"),
    join(TF_DIR, "terraform.tfstate.backup"),
    join(TF_DIR, ".floci-started-at"),
    join(TF_DIR, ".build"),
    join("apps", "web", "public", "config.json"),
  ]) {
    rmSync(join(ROOT, p), { recursive: true, force: true });
  }
  info(".env.local se conserva");
}
console.log(`\n✔ Entorno local ${reset ? "reseteado" : "detenido"}`);
