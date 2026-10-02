// Dependencias y tipos comunes de los casos de uso.
import type { Temporal } from "temporal-polyfill";
import type { RuleFailure } from "../domain/types.ts";
import type { Db } from "../infra/db/client.ts";

export interface ServiceDeps {
  db: Db;
  /** Reloj inyectable: en producción `Temporal.Now.instant`, en los tests un instante fijo. */
  now: () => Temporal.Instant;
  /** APP_TIMEZONE (SPEC §2.2). */
  timezone: string;
}

/** Quién ejecuta la operación, tomado de los claims del token (SPEC §6.2). */
export interface Actor {
  userId: string;
  email: string;
  isAdmin: boolean;
}

export type ServiceResult<T> = { ok: true; value: T } | RuleFailure;

export const success = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

/** Se lanza dentro de una transacción para revertirla y devolver la falla como resultado. */
export class DomainFailure extends Error {
  constructor(readonly failure: RuleFailure) {
    super(failure.code);
  }
}

export function fail(failure: RuleFailure): never {
  throw new DomainFailure(failure);
}

/** Ejecuta `fn` y convierte una DomainFailure lanzada en un resultado fallido. */
export async function catchFailure<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return success(await fn());
  } catch (err) {
    if (err instanceof DomainFailure) return err.failure;
    throw err;
  }
}
