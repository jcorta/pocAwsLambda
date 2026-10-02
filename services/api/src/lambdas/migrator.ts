// Lambda `migrator` (SPEC §3.5): aplica las migraciones. La invocan el pipeline y `local:up`,
// nunca el arranque de las Lambdas de la API. Las migraciones viajan en el zip, junto al bundle.
import { Logger } from "@aws-lambda-powertools/logger";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../infra/config.ts";
import { runMigrations } from "../infra/db/migrate.ts";
import { createPool } from "../infra/runtime.ts";

const logger = new Logger({ serviceName: "reservas-migrator" });
const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface MigratorResult {
  applied: number;
  migrations: string[];
}

export const handler = async (): Promise<MigratorResult> => {
  const pool = await createPool(readConfig());
  try {
    await runMigrations(pool, MIGRATIONS_FOLDER);
    // Tabla de control de Drizzle: una fila por migración aplicada
    const { rows } = await pool.query<{ hash: string }>(
      "select hash from drizzle.__drizzle_migrations order by created_at",
    );
    logger.info("migraciones aplicadas", { total: rows.length });
    return { applied: rows.length, migrations: rows.map((r) => r.hash.slice(0, 12)) };
  } finally {
    await pool.end();
  }
};
