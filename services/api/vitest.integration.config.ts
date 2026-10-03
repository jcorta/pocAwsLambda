import { defineConfig } from "vitest/config";

// Tests de integración contra Postgres real (Testcontainers). Requieren Docker.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    // Arrancar el contenedor de Postgres puede tardar, sobre todo la primera vez (descarga de la imagen)
    hookTimeout: 180_000,
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      // Lo que los tests unitarios dejan afuera porque depende de la base (vitest.config.ts)
      include: ["src/infra/db/**", "src/repositories/**", "src/services/**", "src/handlers/routes/**"],
      exclude: ["src/**/*.test.ts"],
      reportsDirectory: "coverage/integration",
      reporter: ["text-summary", "text"],
      // SPEC §8.4: el total de la API (80 %) se exige en las dos mitades, unit e integración
      thresholds: { lines: 80 },
    },
  },
});
