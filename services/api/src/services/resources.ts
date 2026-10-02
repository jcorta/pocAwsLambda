// Casos de uso de recursos: crear y reemplazar (CU-07, admin) y consultar disponibilidad (CU-03).
import { Temporal } from "temporal-polyfill";
import { checkDateInHorizon, slotStatus, validateResourceSchedule, type SlotStatus } from "../domain/rules.ts";
import { generateSlots } from "../domain/slots.ts";
import { reject } from "../domain/types.ts";
import { PG_UNIQUE_VIOLATION, pgErrorCode, toInstant } from "../infra/db/client.ts";
import { listConfirmedOverlapping } from "../repositories/bookings.ts";
import {
  getResource,
  insertResource,
  replaceResource,
  type Resource,
  type ResourceInput,
} from "../repositories/resources.ts";
import { getSettings } from "../repositories/settings.ts";
import { catchFailure, fail, success, type Actor, type ServiceDeps, type ServiceResult } from "./context.ts";

function validateInput(input: ResourceInput): void {
  const fields = validateResourceSchedule(input);
  if (fields.length > 0) fail(reject("VALIDATION_ERROR", { fields }));
}

async function withNameCheck<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return await catchFailure(fn);
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) return reject("RESOURCE_NAME_TAKEN");
    throw err;
  }
}

export async function createResource(deps: ServiceDeps, input: ResourceInput): Promise<ServiceResult<Resource>> {
  return withNameCheck(() =>
    deps.db.transaction(async (tx) => {
      validateInput(input);
      const id = await insertResource(tx, input);
      return (await getResource(tx, id))!;
    }),
  );
}

/** PUT completo. Cambiar el horario no toca las reservas existentes (RN-08); desactivar tampoco (RN-09). */
export async function updateResource(
  deps: ServiceDeps,
  id: string,
  input: ResourceInput,
): Promise<ServiceResult<Resource>> {
  return withNameCheck(() =>
    deps.db.transaction(async (tx) => {
      validateInput(input);
      if (!(await replaceResource(tx, id, input))) fail(reject("RESOURCE_NOT_FOUND"));
      return (await getResource(tx, id))!;
    }),
  );
}

export interface Availability {
  resourceId: string;
  date: string;
  timezone: string;
  slots: { startsAt: Temporal.Instant; endsAt: Temporal.Instant; status: SlotStatus; mine: boolean }[];
}

/** CU-03: turnos de un día con su estado. Un recurso inactivo no existe para un `user`. */
export async function getAvailability(
  deps: ServiceDeps,
  actor: Actor,
  input: { resourceId: string; date: Temporal.PlainDate },
): Promise<ServiceResult<Availability>> {
  const now = deps.now();
  const resource = await getResource(deps.db, input.resourceId);
  if (!resource || (!resource.isActive && !actor.isAdmin)) return reject("RESOURCE_NOT_FOUND");

  const settings = await getSettings(deps.db);
  const range = checkDateInHorizon({
    date: input.date,
    now,
    timezone: deps.timezone,
    horizonDays: settings.bookingHorizonDays,
  });
  if (!range.ok) return range;

  const slots = generateSlots({
    date: input.date,
    openingHours: resource.openingHours,
    slotMinutes: resource.slotMinutes,
    timezone: deps.timezone,
  });
  const first = slots[0];
  const last = slots.at(-1);
  const bookings =
    first && last ? await listConfirmedOverlapping(deps.db, resource.id, first.startsAt, last.endsAt) : [];
  const booked = bookings.map((b) => ({
    startsAt: toInstant(b.startsAt),
    endsAt: toInstant(b.endsAt),
    isMine: b.userId === actor.userId,
  }));

  return success({
    resourceId: resource.id,
    date: input.date.toString(),
    timezone: deps.timezone,
    slots: slots.map((slot) => ({ ...slot, ...slotStatus({ slot, now, bookings: booked }) })),
  });
}
