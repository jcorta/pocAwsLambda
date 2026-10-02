#!/usr/bin/env node
// Proxy local en el mismo origen que el frontend (hallazgo A8 de docs/spikes/floci.md).
// Cognito de Floci no soporta CORS: el navegador no puede llamarlo desde otro origen. Este proxy atiende en
// localhost (que además es un contexto seguro) y:
//   /_floci/cognito/*  → Cognito de Floci (sin CORS: es el mismo origen)
//   todo lo demás      → el destino (`next dev` o el website de S3 en Floci)
// En AWS real no hace falta: Cognito soporta CORS y el SDK le habla directo.
//
// Uso: node scripts/local/web-proxy.mjs --port 3000 --target http://localhost:3001 [--host-header <host>]
import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const COGNITO_PREFIX = "/_floci/cognito";

export function startProxy({ port, target, hostHeader, floci = "http://localhost:4566", log = console.log }) {
  const targetUrl = new URL(target);
  const flociUrl = new URL(floci);

  /** A dónde va cada pedido, y con qué Host. */
  function route(url = "/") {
    if (url === COGNITO_PREFIX || url.startsWith(`${COGNITO_PREFIX}/`) || url.startsWith(`${COGNITO_PREFIX}?`)) {
      return { base: flociUrl, host: flociUrl.host, path: url.slice(COGNITO_PREFIX.length) || "/" };
    }
    return { base: targetUrl, host: hostHeader ?? targetUrl.host, path: url };
  }

  const server = http.createServer((req, res) => {
    const { base, host, path } = route(req.url);
    const upstream = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path,
        method: req.method,
        headers: { ...req.headers, host },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Proxy: no se pudo conectar con ${base.host}: ${err.message}`);
    });
    req.pipe(upstream);
  });

  // WebSocket (recarga en caliente de `next dev`): se reenvía el handshake y se conectan los dos sockets
  server.on("upgrade", (req, socket, head) => {
    const { base, host, path } = route(req.url);
    const upstream = net.connect(Number(base.port || 80), base.hostname, () => {
      const headers = Object.entries({ ...req.headers, host }).map(([k, v]) => `${k}: ${v}`);
      upstream.write(`${req.method} ${path} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => {
      log(
        `Proxy en http://localhost:${port} → ${target}${hostHeader ? ` (Host: ${hostHeader})` : ""}, Cognito en ${COGNITO_PREFIX}`,
      );
      resolve(server);
    });
  });
}

// Ejecución directa
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: { port: { type: "string" }, target: { type: "string" }, "host-header": { type: "string" } },
  });
  if (!values.port || !values.target) {
    console.error("Uso: node scripts/local/web-proxy.mjs --port <puerto> --target <url> [--host-header <host>]");
    process.exit(2);
  }
  await startProxy({ port: Number(values.port), target: values.target, hostHeader: values["host-header"] });
}
