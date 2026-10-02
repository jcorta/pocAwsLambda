#!/usr/bin/env node
// Smoke test de los bundles: cada uno se carga en Node (detecta problemas de ESM/CommonJS del bundle)
// y las Lambdas de la API responden 401 a un request sin ID token, sin tocar la base ni AWS.
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_LAMBDAS = ["me", "resources", "bookings", "admin"];
let failed = false;

const unauthenticated = {
  version: "2.0",
  routeKey: "GET /v1/me",
  rawPath: "/v1/me",
  headers: {},
  isBase64Encoded: false,
  requestContext: { requestId: "check", authorizer: { jwt: { claims: { token_use: "access" }, scopes: [] } } },
};

process.env["DB_SECRET_ARN"] ??= "arn:aws:secretsmanager:us-east-1:000000000000:secret:check";
process.env["POWERTOOLS_LOG_LEVEL"] ??= "SILENT";

for (const name of [...API_LAMBDAS, "migrator"]) {
  const file = join(root, "dist", "lambdas", name, "index.mjs");
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.handler !== "function") throw new Error("no exporta `handler`");
    if (API_LAMBDAS.includes(name)) {
      const res = await mod.handler(unauthenticated, { awsRequestId: "check" });
      if (res.statusCode !== 401) throw new Error(`esperaba 401 sin ID token, respondió ${res.statusCode}`);
    } else {
      await access(join(root, "dist", "lambdas", name, "migrations", "meta", "_journal.json"));
    }
    console.log(`✔ ${name}`);
  } catch (err) {
    failed = true;
    console.error(`✖ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exitCode = failed ? 1 : 0;
