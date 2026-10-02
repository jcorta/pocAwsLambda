// Recursos compartidos de una Lambda, creados una vez por contenedor y reutilizados en caliente (SPEC §6.5).
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { Temporal } from "temporal-polyfill";
import type { ServiceDeps } from "../services/context.ts";
import { readConfig, type LambdaConfig } from "./config.ts";
import { createDb } from "./db/client.ts";

interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  dbname: string;
}

/** Sin endpoint explícito: en Floci el SDK toma AWS_ENDPOINT_URL, que Floci inyecta en cada Lambda (hallazgo A4). */
async function readDbCredentials(secretArn: string): Promise<DbCredentials> {
  const out = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!out.SecretString) throw new Error("El secreto de la base no tiene SecretString");
  return JSON.parse(out.SecretString) as DbCredentials;
}

export async function createPool(config: LambdaConfig, max = 1): Promise<pg.Pool> {
  const c = await readDbCredentials(config.dbSecretArn);
  return new pg.Pool({
    host: c.host,
    port: Number(c.port),
    user: c.username,
    password: c.password,
    database: c.dbname,
    // Una conexión por contenedor: la concurrencia la da Lambda, no el pool (SPEC §6.5)
    max,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    ssl: config.dbSsl === "require" ? { rejectUnauthorized: false } : false,
  });
}

/**
 * Devuelve una función que resuelve las dependencias de los servicios una sola vez por contenedor.
 * Si la inicialización falla (por ejemplo, el secreto no está disponible), se reintenta en la siguiente invocación.
 */
export function lazyServiceDeps(env: NodeJS.ProcessEnv = process.env): () => Promise<ServiceDeps> {
  let pending: Promise<ServiceDeps> | undefined;
  return () => {
    pending ??= (async () => {
      const config = readConfig(env);
      const pool = await createPool(config);
      return { db: createDb(pool), now: () => Temporal.Now.instant(), timezone: config.timezone };
    })().catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}
