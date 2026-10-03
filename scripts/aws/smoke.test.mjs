// Tests de los smoke tests de AWS contra un servidor falso que hace de sitio, API y Cognito. Se corren con `node --test`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SMOKE = join(dirname(fileURLToPath(import.meta.url)), "smoke.mjs");

let server, base;
let broken = false;

before(async () => {
  server = http.createServer((req, res) => {
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/site/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html></html>");
    }
    if (req.url === "/site/config.json") return json(200, { apiUrl: `${base}/api`, cognito: { userPoolId: "pool" } });
    if (req.url === "/api/v1/me" && req.method === "OPTIONS") {
      return json(204, {}, { "access-control-allow-origin": `${base}/site` });
    }
    if (req.url === "/api/v1/me") return json(broken ? 200 : 401, {});
    if (req.url === "/pool/.well-known/jwks.json") return json(200, { keys: [{ kid: "k" }] });
    json(404, {});
  });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

function runSmoke() {
  const file = join(mkdtempSync(join(tmpdir(), "smoke-")), "outputs.json");
  const outputs = {
    frontend_url: `${base}/site/`,
    api_url: `${base}/api`,
    user_pool_id: "pool",
    cognito_issuer_url: `${base}/pool`,
  };
  writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, { value: v }]))));
  // Asíncrono: el servidor falso corre en este mismo proceso y spawnSync lo bloquearía
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SMOKE, file]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("pasan todos los chequeos contra un entorno sano", async () => {
  const r = await runSmoke();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.match(/✔/g)?.length, 5);
});

test("falla si la API responde sin pedir token", async () => {
  broken = true;
  const r = await runSmoke();
  broken = false;
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✖ la API rechaza un request sin token con 401/);
});
