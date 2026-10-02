#!/usr/bin/env node
// `pnpm local:logs`           → últimos logs de Floci
// `pnpm local:logs <lambda>`  → logs de los últimos 30 min de una Lambda (me, resources, bookings, admin, migrator)
import { compose, fail, FLOCI_URL } from "./lib.mjs";

const lambda = process.argv[2];
const LAMBDAS = ["me", "resources", "bookings", "admin", "migrator"];

if (!lambda) {
  compose(["logs", "--tail", "200", "floci"]);
  process.exit(0);
}
if (!LAMBDAS.includes(lambda)) fail(`Lambda desconocida: ${lambda}. Opciones: ${LAMBDAS.join(", ")}`);

// CloudWatch Logs de Floci por su API JSON (sin sumar otro cliente del SDK)
const res = await fetch(FLOCI_URL, {
  method: "POST",
  headers: {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-target": "Logs_20140328.FilterLogEvents",
    // Floci rutea por el servicio de la firma; la firma en sí no se valida
    authorization:
      "AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/logs/aws4_request, SignedHeaders=host, Signature=x",
  },
  body: JSON.stringify({ logGroupName: `/aws/lambda/reservas-local-${lambda}`, startTime: Date.now() - 30 * 60_000 }),
}).catch(() => fail("Floci no está levantado. Ejecutar primero: pnpm local:up"));

if (!res.ok) fail(`CloudWatch Logs respondió ${res.status}: ${await res.text()}`);
const { events = [] } = await res.json();
if (events.length === 0) console.log(`(sin logs de ${lambda} en los últimos 30 minutos)`);
for (const e of events) console.log(`${new Date(e.timestamp).toISOString()}  ${e.message.trimEnd()}`);
