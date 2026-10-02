import { defineConfig } from "vitest/config";

// Tests de integración contra Postgres real (Testcontainers). Requieren Docker.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.int.test.ts"],
    // Arrancar el contenedor de Postgres puede tardar, sobre todo la primera vez (descarga de la imagen)
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
