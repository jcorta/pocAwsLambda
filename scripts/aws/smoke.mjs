#!/usr/bin/env node
// Smoke tests contra un entorno desplegado en AWS (SPEC §9.2, paso 7). No crean datos: solo leen.
// Uso: `node scripts/aws/smoke.mjs <outputs.json>`, con la salida de `terraform output -json` de envs/aws.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/aws/smoke.mjs <outputs.json>");
  process.exit(1);
}
const outputs = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(file, "utf8"))).map(([k, v]) => [k, v.value]),
);
const site = outputs.frontend_url.replace(/\/$/, "");
const api = outputs.api_url.replace(/\/$/, "");

const checks = [
  [
    "el sitio responde con el HTML de inicio",
    async () => {
      const res = await fetch(`${site}/`);
      return res.ok && (res.headers.get("content-type") ?? "").includes("text/html");
    },
  ],
  [
    "config.json apunta a la API y al pool de este entorno",
    async () => {
      const config = await (await fetch(`${site}/config.json`)).json();
      return config.apiUrl === outputs.api_url && config.cognito?.userPoolId === outputs.user_pool_id;
    },
  ],
  ["la API rechaza un request sin token con 401", async () => (await fetch(`${api}/v1/me`)).status === 401],
  [
    "el preflight CORS desde el sitio devuelve el origen permitido",
    async () => {
      const res = await fetch(`${api}/v1/me`, {
        method: "OPTIONS",
        headers: {
          origin: site,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });
      return res.headers.get("access-control-allow-origin") === site;
    },
  ],
  [
    "Cognito publica las claves con las que valida el JWT authorizer",
    async () => {
      const jwks = await (await fetch(`${outputs.cognito_issuer_url}/.well-known/jwks.json`)).json();
      return Array.isArray(jwks.keys) && jwks.keys.length > 0;
    },
  ],
];

let failed = 0;
for (const [name, check] of checks) {
  const ok = await check().catch((err) => {
    console.error(`  ${err.message}`);
    return false;
  });
  console.log(`${ok ? "✔" : "✖"} ${name}`);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`\n${failed} de ${checks.length} smoke tests fallaron`);
  // exitCode y no exit(): cortar el proceso con sockets de fetch abiertos lo hace fallar en Windows
  process.exitCode = 1;
}
