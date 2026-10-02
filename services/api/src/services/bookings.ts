// Casos de uso de reservas: reservar (CU-04) y cancelar (CU-06).
import { Temporal } from "temporal-polyfill";
import { checkActiveBookingsLimit, checkCancellation, validateBookingSlot } from "../domain/rules.ts";
import { reject } from "../domain/types.ts";
import { PG_EXCLUSION_VIOLATION, pgErrorCode, toInstant } from "../infra/db/client.ts";
import {
  countActiveByUser,
  findBookingForUpdate,
  insertBooking,
  listConfirmedOverlapping,
  markCancelled,
  type BookingRow,
} from "../repositories/bookings.ts";
import { getResource } from "../repositories/resources.ts";
import { getSettings } from "../repositories/settings.ts";
import { lockUser, upsertUser } from "../repositories/users.ts";
import { catchFailure, fail, type Actor, type ServiceDeps, type ServiceResult } from "./context.ts";

/**
 * Reserva un turno. Transacción de SPEC §3.3:
 * 1. Upsert y bloqueo de la fila del usuario: serializa sus reservas concurrentes (RN-05).
 * 2. Settings y recurso; validación de RN-02, RN-03 y RN-04.
 * 3. Conteo de reservas activas (RN-05), salvo admin.
 * 4. INSERT protegido por la exclusion constraint: resuelve la concurrencia entre usuarios (RN-01).
 */
export async function reserveBooking(
  deps: ServiceDeps,
  actor: Actor,
  input: { resourceId: string; startsAt: Temporal.Instant },
): Promise<ServiceResult<BookingRow>> {
  const now = deps.now();
  try {
    return await catchFailure(() =>
      deps.db.transaction(async (tx) => {
        await upsertUser(tx, { id: actor.userId, email: actor.email });
        await lockUser(tx, actor.userId);

        const settings = await getSettings(tx);
        const resource = await getResource(tx, input.resourceId);
        if (!resource || !resource.isActive) fail(reject("RESOURCE_NOT_FOUND"));

        const slot = validateBookingSlot({
          startsAt: input.startsAt,
          now,
          timezone: deps.timezone,
          horizonDays: settings.bookingHorizonDays,
          openingHours: resource.openingHours,
          slotMinutes: resource.slotMinutes,
        });
        if (!slot.ok) fail(slot);

        if (!actor.isAdmin) {
          const activeCount = await countActiveByUser(tx, actor.userId, now);
          const limit = checkActiveBookingsLimit({
            activeCount,
            limit: settings.maxActiveBookingsPerUser,
            isAdmin: actor.isAdmin,
          });
          if (!limit.ok) fail(limit);
        }

        return insertBooking(tx, {
          resourceId: resource.id,
          userId: actor.userId,
          startsAt: slot.slot.startsAt,
          endsAt: slot.slot.endsAt,
        });
      }),
    );
  } catch (err) {
    if (pgErrorCode(err) !== PG_EXCLUSION_VIOLATION) throw err;
    // La transacción ya se revirtió: se consulta aparte quién ocupa el turno, para informar `mine` (SPEC §4.3)
    return reject("SLOT_TAKEN", { mine: await isTakenBy(deps, actor.userId, input) });
  }
}

async function isTakenBy(
  deps: ServiceDeps,
  userId: string,
  input: { resourceId: string; startsAt: Temporal.Instant },
): Promise<boolean> {
  // Intervalo mínimo que contiene el inicio. Un milisegundo, porque Postgres y Date no guardan nanosegundos
  const overlapping = await listConfirmedOverlapping(
    deps.db,
    input.resourceId,
    input.startsAt,
    input.startsAt.add({ milliseconds: 1 }),
  );
  return overlapping.some((b) => b.userId === userId);
}

/**
 * Cancela una reserva (CU-06). Un `user` solo cancela las propias y respetando la anticipación mínima (RN-06);
 * un admin cancela cualquier reserva futura.
 */
export async function cancelBooking(
  deps: ServiceDeps,
  actor: Actor,
  bookingId: string,
): Promise<ServiceResult<BookingRow>> {
  const now = deps.now();
  return catchFailure(() =>
    deps.db.transaction(async (tx) => {
      // `cancelled_by` referencia a users: el admin puede no haber reservado nunca
      await upsertUser(tx, { id: actor.userId, email: actor.email });

      const booking = await findBookingForUpdate(tx, bookingId);
      if (!booking) fail(reject("BOOKING_NOT_FOUND"));

      const settings = await getSettings(tx);
      const check = checkCancellation({
        booking: {
          startsAt: toInstant(booking.startsAt),
          status: booking.status,
          isOwner: booking.userId === actor.userId,
        },
        now,
        minHours: settings.cancellationMinHours,
        isAdmin: actor.isAdmin,
      });
      if (!check.ok) fail(check);

      return markCancelled(tx, booking.id, actor.userId, now);
    }),
  );
}
