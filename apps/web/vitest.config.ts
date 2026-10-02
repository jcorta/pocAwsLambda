import { defineConfig } from "vitest/config";

// Tests unitarios del frontend, con DOM simulado (jsdom)
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
