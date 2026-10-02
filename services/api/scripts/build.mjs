#!/usr/bin/env node
// Bundle de cada Lambda con esbuild (SPEC §6.5): dist/lambdas/<nombre>/index.mjs.
// Terraform comprime cada carpeta con archive_file (SPEC §7.4). El migrator lleva además sus migraciones.
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "dist", "lambdas");
export const LAMBDAS = ["me", "resources", "bookings", "admin", "migrator", "notifier"];

await rm(outRoot, { recursive: true, force: true });

for (const name of LAMBDAS) {
  const outdir = join(outRoot, name);
  await build({
    entryPoints: [join(root, "src", "lambdas", `${name}.ts`)],
    outfile: join(outdir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22", // runtime de las Lambdas (SPEC §6.5)
    format: "esm",
    minify: true,
    sourcemap: true,
    legalComments: "none",
    // pg intenta cargar su binding nativo opcional; no se usa
    external: ["pg-native"],
    // Dependencias CommonJS (pg, AWS SDK) dentro de un bundle ESM necesitan `require`
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  if (name === "migrator") await cp(join(root, "migrations"), join(outdir, "migrations"), { recursive: true });
  console.log(`✔ ${name} → dist/lambdas/${name}/index.mjs`);
}
