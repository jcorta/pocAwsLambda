// E2E de UI (SPEC §8): recorridos clave en el sitio servido desde el S3 de Floci.
// Requiere `pnpm local:up` y `pnpm deploy:web:local`. Playwright levanta solo el proxy del mismo origen
// (`pnpm local:site`, hallazgo A8), y el navegador entra por http://localhost:3002.
import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3002/";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  use: { baseURL, trace: "retain-on-failure", locale: "es-AR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node ${JSON.stringify(join(root, "scripts", "local", "site.mjs"))}`,
    url: new URL("config.json", baseURL).toString(),
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
