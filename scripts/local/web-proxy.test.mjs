// Tests del proxy del mismo origen (hallazgo A8), con servidores HTTP falsos. Se corren con `node --test`.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { startProxy } from "./web-proxy.mjs";

/** Servidor que responde con lo que recibió: método, ruta, Host y body. */
function echoServer(name) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-upstream": name });
      res.end(JSON.stringify({ name, method: req.method, url: req.url, host: req.headers.host, body }));
    });
  });
  return new Promise((resolve) => server.listen(0, "localhost", () => resolve(server)));
}

let floci, site, proxy, base;

before(async () => {
  floci = await echoServer("floci");
  site = await echoServer("site");
  proxy = await startProxy({
    port: 0,
    target: `http://localhost:${site.address().port}`,
    hostHeader: "bucket.s3-website.localhost.floci.io:4566",
    floci: `http://localhost:${floci.address().port}`,
    log: () => {},
  });
  base = `http://localhost:${proxy.address().port}`;
});

after(() => {
  for (const s of [proxy, floci, site]) s.close();
});

test("reenvía /_floci/cognito a Floci, sin el prefijo y con el body", async () => {
  const res = await fetch(`${base}/_floci/cognito`, { method: "POST", body: '{"x":1}' });
  const echo = await res.json();
  assert.equal(echo.name, "floci");
  assert.equal(echo.url, "/");
  assert.equal(echo.method, "POST");
  assert.equal(echo.body, '{"x":1}');
});

test("conserva la ruta que sigue al prefijo de Cognito", async () => {
  const echo = await (await fetch(`${base}/_floci/cognito/_aws/ses`)).json();
  assert.equal(echo.name, "floci");
  assert.equal(echo.url, "/_aws/ses");
});

test("todo lo demás va al sitio, con el Host del website de S3", async () => {
  const echo = await (await fetch(`${base}/resources/?id=1`)).json();
  assert.equal(echo.name, "site");
  assert.equal(echo.url, "/resources/?id=1");
  assert.equal(echo.host, "bucket.s3-website.localhost.floci.io:4566");
});

test("una ruta que solo empieza parecido no va a Cognito", async () => {
  const echo = await (await fetch(`${base}/_floci/cognitox`)).json();
  assert.equal(echo.name, "site");
});

test("si el destino no responde, devuelve 502", async () => {
  const down = await startProxy({ port: 0, target: "http://localhost:1", log: () => {} });
  const res = await fetch(`http://localhost:${down.address().port}/`);
  assert.equal(res.status, 502);
  down.close();
});
