import { eq, sql } from "drizzle-orm";
import type { BookingSettings } from "../domain/types.ts";
import type { DbOrTx } from "../infra/db/client.ts";
import { settings } from "../infra/db/schema.ts";

const columns = {
  maxActiveBookingsPerUser: settings.maxActiveBookingsPerUser,
  cancellationMinHours: settings.cancellationMinHours,
  bookingHorizonDays: settings.bookingHorizonDays,
  updatedAt: settings.updatedAt,
};

export type SettingsRecord = BookingSettings & { updatedAt: Date };

/** La fila única la crea la migración (SPEC §3.4), así que siempre existe. */
export async function getSettings(db: DbOrTx): Promise<SettingsRecord> {
  const [row] = await db.select(columns).from(settings).where(eq(settings.id, 1));
  if (!row) throw new Error("Falta la fila de settings: ¿se aplicaron las migraciones?");
  return row;
}

export async function updateSettings(db: DbOrTx, values: BookingSettings): Promise<SettingsRecord> {
  const [row] = await db
    .update(settings)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(settings.id, 1))
    .returning(columns);
  return row!;
}
