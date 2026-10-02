import { defineConfig } from "vitest/config";

// E2E contra la API desplegada en Floci. Requiere `pnpm local:up`.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    // Arranques en frío de las Lambdas (contenedores en Floci)
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
