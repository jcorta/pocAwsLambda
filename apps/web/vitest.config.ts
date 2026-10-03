import { defineConfig } from "vitest/config";

// Tests unitarios del frontend, con DOM simulado (jsdom)
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // SPEC §8.4: el frontend solo reporta la cobertura, sin umbral
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
      reporter: ["text-summary"],
    },
  },
});
