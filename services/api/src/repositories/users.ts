import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../infra/db/client.ts";
import { users } from "../infra/db/schema.ts";

/** Crea o actualiza el espejo del usuario de Cognito (SPEC §3.2). */
export async function upsertUser(db: DbOrTx, user: { id: string; email: string }): Promise<void> {
  await db
    .insert(users)
    .values(user)
    .onConflictDoUpdate({ target: users.id, set: { email: user.email, updatedAt: sql`now()` } });
}

/**
 * Bloquea la fila del usuario hasta el fin de la transacción: serializa sus reservas concurrentes (RN-05, §3.3).
 * El `ON CONFLICT DO UPDATE` de `upsertUser` ya toma ese mismo lock; este SELECT lo hace explícito
 * para no depender de un detalle del upsert (verificado con un test de mutación: sin ninguno de los dos, RN-05 falla).
 */
export async function lockUser(tx: DbOrTx, id: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update");
}
