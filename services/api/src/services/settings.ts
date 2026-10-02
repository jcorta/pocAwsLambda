// Configuración de reglas (CU-09, admin).
import type { FieldError } from "../domain/rules.ts";
import { reject, type BookingSettings } from "../domain/types.ts";
import { getSettings, updateSettings } from "../repositories/settings.ts";
import { success, type ServiceDeps, type ServiceResult } from "./context.ts";

const MINIMUMS: Record<keyof BookingSettings, number> = {
  maxActiveBookingsPerUser: 1,
  cancellationMinHours: 0,
  bookingHorizonDays: 1,
};

export function readSettings(deps: ServiceDeps): Promise<BookingSettings> {
  return getSettings(deps.db);
}

/** Los cambios aplican a las operaciones siguientes; no afectan las reservas existentes. */
export async function changeSettings(
  deps: ServiceDeps,
  values: BookingSettings,
): Promise<ServiceResult<BookingSettings>> {
  const fields: FieldError[] = [];
  for (const [key, min] of Object.entries(MINIMUMS) as [keyof BookingSettings, number][]) {
    const v = values[key];
    // smallint en la base: hasta 32767
    if (!Number.isInteger(v) || v < min || v > 32767) {
      fields.push({ path: key, message: `Debe ser un entero mayor o igual a ${min}` });
    }
  }
  if (fields.length > 0) return reject("VALIDATION_ERROR", { fields });
  return success(await updateSettings(deps.db, values));
}
