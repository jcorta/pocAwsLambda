// Cliente Drizzle sobre un pool de pg. En las Lambdas el pool tiene `max: 1` (SPEC §6.5).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;
/** Una transacción tiene la misma API que la base, así los repositorios aceptan cualquiera de las dos. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

export const toDate = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);
export const toInstant = (date: Date): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(date.getTime());

/** Código SQLSTATE de un error de Postgres, si lo es. Drizzle a veces lo envuelve en `cause`. */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";
