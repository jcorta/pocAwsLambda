// Aplica las migraciones versionadas en services/api/migrations (SPEC §3.5).
// Lo usan la Lambda migrator (F3) y los tests de integración. Nunca se llama en el arranque de las Lambdas de la API.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder });
}
