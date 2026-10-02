#!/usr/bin/env node
// Verifica los prerequisitos del entorno local (SPEC §10). Uso: `npm run doctor`.
// Sin dependencias: corre antes de `pnpm install` y en cualquier sistema operativo.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

// Imagen efímera para verificar el acceso al socket de Docker desde un contenedor
const SOCKET_PROBE_IMAGE = "docker:29-cli";
const REQUIRED_PORTS = [4566, 3000, ...range(7001, 7010)];
const OPTIONAL_PORTS = [
  { port: 3001, service: "next dev detrás del proxy de `pnpm dev`" },
  { port: 3002, service: "sitio en S3 por el proxy (`pnpm local:site`, E2E de UI)" },
  { port: 4500, service: "Floci UI" },
];
const MIN_DOCKER_MEMORY_GB = 4;

const results = [];
const ok = (name, detail) => results.push({ level: "ok", name, detail });
const warn = (name, detail, hint) => results.push({ level: "warn", name, detail, hint });
const fail = (name, detail, hint) => results.push({ level: "fail", name, detail, hint });

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// En Windows, pnpm y aws son scripts .cmd y Node solo los ejecuta a través del shell.
// En ese caso se pasa un único string (los argumentos son constantes de este archivo, no entrada del usuario).
const NEEDS_SHELL_ON_WINDOWS = new Set(["pnpm", "aws"]);

function run(command, args) {
  const opts = { encoding: "utf8", timeout: 120_000 };
  const r =
    isWindows && NEEDS_SHELL_ON_WINDOWS.has(command)
      ? spawnSync([command, ...args].join(" "), { ...opts, shell: true })
      : spawnSync(command, args, opts);
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function readText(file) {
  return readFileSync(join(root, file), "utf8").trim();
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

async function flociRunning() {
  try {
    const res = await fetch("http://localhost:4566/_floci/health", { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function portHint(port) {
  return isWindows
    ? `Ver qué proceso lo usa: netstat -ano | findstr :${port}`
    : `Ver qué proceso lo usa: lsof -i :${port}`;
}

// --- Chequeos ---

function checkNode() {
  const required = Number.parseInt(readText(".nvmrc"), 10);
  const current = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (current >= required) ok("Node.js", `v${process.versions.node} (mínimo ${required})`);
  else
    fail(
      "Node.js",
      `v${process.versions.node}, se requiere ${required} o superior`,
      "Instalar Node.js LTS desde https://nodejs.org",
    );
}

function checkPnpm() {
  const expected = JSON.parse(readText("package.json")).packageManager?.split("@")[1];
  const r = run("pnpm", ["--version"]);
  if (!r.ok) {
    fail("pnpm", "no está disponible", "Ejecutar: corepack enable");
    return;
  }
  if (expected && r.stdout !== expected) {
    warn(
      "pnpm",
      `v${r.stdout}, el repo espera ${expected}`,
      "Ejecutar: corepack enable (usa la versión de packageManager)",
    );
    return;
  }
  ok("pnpm", `v${r.stdout}`);
}

function checkDocker() {
  const cli = run("docker", ["--version"]);
  if (!cli.ok) {
    fail("Docker", "no está instalado", "Instalar Docker Desktop (Windows/macOS) o Docker Engine (Linux)");
    return false;
  }
  const info = run("docker", ["info", "--format", "{{.ServerVersion}}|{{.MemTotal}}"]);
  if (!info.ok) {
    fail("Docker", "el daemon no está corriendo", "Iniciar Docker Desktop o el servicio de Docker");
    return false;
  }
  const [version, memBytes] = info.stdout.split("|");
  ok("Docker", `daemon v${version}`);

  const memGb = Number(memBytes) / 1024 ** 3;
  if (memGb >= MIN_DOCKER_MEMORY_GB) ok("Memoria de Docker", `${memGb.toFixed(1)} GB`);
  else
    warn(
      "Memoria de Docker",
      `${memGb.toFixed(1)} GB (se recomiendan ${MIN_DOCKER_MEMORY_GB} GB)`,
      "Aumentarla en la configuración de Docker Desktop",
    );
  return true;
}

function checkCompose() {
  const r = run("docker", ["compose", "version", "--short"]);
  const major = Number.parseInt(r.stdout.replace(/^v/, "").split(".")[0] ?? "0", 10);
  if (r.ok && major >= 2) ok("Docker Compose", `v${r.stdout.replace(/^v/, "")}`);
  else
    fail(
      "Docker Compose",
      r.ok ? `v${r.stdout}, se requiere v2 o superior` : "no está disponible",
      "Actualizar Docker para tener `docker compose` (v2)",
    );
}

function checkDockerSocket() {
  const r = run("docker", [
    "run",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    SOCKET_PROBE_IMAGE,
    "docker",
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if (r.ok) ok("Socket de Docker desde contenedores", "accesible (lo necesita Floci para levantar Lambdas y RDS)");
  else
    fail(
      "Socket de Docker desde contenedores",
      r.stderr.split("\n").at(-1) || "no accesible",
      "En Docker Desktop: Settings → Advanced → habilitar el socket de Docker por defecto",
    );
}

async function checkPorts() {
  const floci = await flociRunning();
  const busy = [];
  for (const port of REQUIRED_PORTS) if (!(await portFree(port))) busy.push(port);

  // Si Floci de este proyecto ya está levantado, sus puertos ocupados son esperables
  const flociPorts = new Set([4566, ...range(7001, 7010)]);
  const unexpected = floci ? busy.filter((p) => !flociPorts.has(p)) : busy;

  if (unexpected.length === 0)
    ok(
      "Puertos obligatorios",
      floci
        ? "libres (4566 y 7001-7010 los usa Floci, ya levantado)"
        : `libres (${REQUIRED_PORTS[0]}, 3000, 7001-7010)`,
    );
  else fail("Puertos obligatorios", `ocupados: ${unexpected.join(", ")}`, portHint(unexpected[0]));

  for (const { port, service } of OPTIONAL_PORTS) {
    if (!(await portFree(port)))
      warn(`Puerto ${port}`, `ocupado (${service} no va a poder levantarse)`, portHint(port));
  }
}

function checkTerraformVersion() {
  const expected = readText(".terraform-version");
  const compose = readText("docker-compose.yml");
  const match = compose.match(/hashicorp\/terraform:(\S+)/);
  if (match?.[1] === expected) ok("Versión de Terraform", `${expected} (contenedor, no hace falta instalarlo)`);
  else
    warn(
      "Versión de Terraform",
      `.terraform-version dice ${expected} y docker-compose.yml usa ${match?.[1] ?? "?"}`,
      "Alinear las dos versiones",
    );
}

function checkAwsCli() {
  const r = run("aws", ["--version"]);
  if (r.ok) ok("AWS CLI", r.stdout.split(" ")[0] ?? "instalada");
  else warn("AWS CLI", "no instalada (opcional)", "Útil para inspeccionar recursos: https://aws.amazon.com/cli/");
}

// --- Ejecución ---

checkNode();
checkPnpm();
const docker = checkDocker();
if (docker) {
  checkCompose();
  checkDockerSocket();
}
await checkPorts();
checkTerraformVersion();
checkAwsCli();

const icon = { ok: "✔", warn: "⚠", fail: "✖" };
console.log("\nPrerequisitos del entorno local\n");
for (const r of results) {
  console.log(`${icon[r.level]} ${r.name}: ${r.detail}`);
  if (r.hint) console.log(`    → ${r.hint}`);
}

const failures = results.filter((r) => r.level === "fail").length;
const warnings = results.filter((r) => r.level === "warn").length;
console.log(
  `\n${failures === 0 ? "Listo" : "Faltan prerequisitos"}: ${failures} error(es), ${warnings} advertencia(s)\n`,
);
process.exitCode = failures > 0 ? 1 : 0;
