// Postgres 16 real para los tests de integración (SPEC §8), con las migraciones aplicadas.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../../src/infra/db/migrate.ts";

// Misma imagen que usa Floci para RDS (docs/spikes/floci.md)
export const POSTGRES_IMAGE = "postgres:16-alpine";
export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  stop(): Promise<void>;
}

export async function startTestDatabase({ migrate = true } = {}): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 10 });
  if (migrate) await runMigrations(pool, MIGRATIONS_FOLDER);
  return {
    container,
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
