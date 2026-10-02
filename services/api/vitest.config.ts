import { defineConfig } from "vitest/config";

// Tests unitarios: rápidos y sin dependencias externas
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
