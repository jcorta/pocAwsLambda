#!/usr/bin/env node
// `pnpm local:site`: sirve el sitio publicado en el S3 de Floci en http://localhost:3002, a través del proxy
// del mismo origen (hallazgos A8 y A9). Lo usan los E2E de UI (Playwright lo arranca solo) y sirve para probarlo a mano.
import { FLOCI_URL, terraformOutputs } from "./lib.mjs";
import { startProxy } from "./web-proxy.mjs";

export const SITE_PORT = 3002;

const { frontend_bucket: bucket, api_url: apiUrl } = terraformOutputs();
// Se conecta a Floci por localhost con el Host del website del bucket y de la API: no depende del DNS
// público de *.localhost.floci.io (hallazgo A6)
await startProxy({
  port: SITE_PORT,
  target: FLOCI_URL,
  hostHeader: `${bucket}.s3-website.localhost.floci.io:4566`,
  apiHost: new URL(apiUrl).host,
});
