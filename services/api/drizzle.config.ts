// Configuración de drizzle-kit: solo genera las migraciones SQL (no se conecta a ninguna base).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infra/db/schema.ts",
  out: "./migrations",
});
