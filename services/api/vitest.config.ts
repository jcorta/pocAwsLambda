import { defineConfig } from "vitest/config";

// Tests unitarios: rápidos y sin dependencias externas
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/infra/db/**"],
      reporter: ["text-summary", "text"],
      // SPEC §8.4: el dominio exige 90 % de líneas. El umbral total de la API (80 %) se aplica en F6.
      thresholds: {
        "src/domain/**": { lines: 90 },
      },
    },
  },
});
