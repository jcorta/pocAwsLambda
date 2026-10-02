import { defineConfig } from "vitest/config";

// Tests unitarios: rápidos y sin dependencias externas
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Lo que depende de la base se cubre con los tests de integración
      exclude: [
        "src/**/*.test.ts",
        "src/**/__fixtures__/**",
        "src/infra/db/**",
        "src/repositories/**",
        "src/services/**",
        "src/handlers/routes/**",
        // Entrypoints y acceso a Secrets Manager: se prueban con check:bundles y los E2E en Floci
        "src/lambdas/**",
        "src/infra/runtime.ts",
      ],
      reporter: ["text-summary", "text"],
      // SPEC §8.4: el dominio exige 90 % de líneas. El umbral total de la API (80 %) se aplica en F6.
      thresholds: {
        "src/domain/**": { lines: 90 },
      },
    },
  },
});
