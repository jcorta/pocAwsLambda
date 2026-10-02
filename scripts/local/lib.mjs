// Utilidades compartidas por los scripts del entorno local (SPEC §10). Solo Node, sin depender del sistema operativo.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TF_DIR = "infra/envs/local";
export const FLOCI_URL = "http://localhost:4566";

/** Configuración de los clientes del AWS SDK contra Floci (desde el host). */
export const AWS = {
  region: "us-east-1",
  endpoint: FLOCI_URL,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

export const step = (msg) => console.log(`\n▸ ${msg}`);
export const info = (msg) => console.log(`  ${msg}`);

export function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/** Ejecuta un comando mostrando su salida. Corta el script si falla. */
export function run(command, args, { capture = false, allowFailure = false } = {}) {
  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (r.error) fail(`No se pudo ejecutar ${command}: ${r.error.message}`);
  if (r.status !== 0 && !allowFailure) fail(`Falló: ${command} ${args.join(" ")}`);
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
}

/** Ejecuta un script de Node del repo con el mismo Node que corre este (sin pasar por pnpm ni por el shell). */
export function node(script, args = []) {
  return run(process.execPath, [script, ...args]);
}

export function compose(args, opts) {
  return run("docker", ["compose", ...args], opts);
}

export function terraform(args, opts) {
  return compose(["run", "--rm", "-T", "terraform", `-chdir=${TF_DIR}`, ...args], opts);
}

/** Outputs de Terraform como objeto plano (`terraform output -json`). */
export function terraformOutputs() {
  const { stdout } = terraform(["output", "-json"], { capture: true });
  const raw = JSON.parse(stdout || "{}");
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.value]));
}

export async function waitForFloci(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${FLOCI_URL}/_floci/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // todavía arrancando
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  fail("Floci no respondió a tiempo en http://localhost:4566. Ver: pnpm local:logs");
}

/** Lee .env.local (lo crea desde .env.example la primera vez). Formato KEY=VALUE, sin dependencias. */
export function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) {
    copyFileSync(join(ROOT, ".env.example"), file);
    info("Se creó .env.local a partir de .env.example");
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
