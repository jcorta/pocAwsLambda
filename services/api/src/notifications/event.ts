// Evento que la Lambda `bookings` publica en SQS después del commit y consume el `notifier` (SPEC §6.3).
import { z } from "zod";

export const BookingEventSchema = z.object({
  eventId: z.uuid(),
  type: z.enum(["booking_confirmed", "booking_cancelled"]),
  occurredAt: z.iso.datetime({ offset: true }),
  booking: z.object({
    id: z.uuid(),
    resourceName: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    userEmail: z.string(),
  }),
  cancelledBy: z.enum(["self", "admin"]).nullable(),
});

export type BookingEvent = z.infer<typeof BookingEventSchema>;

/**
 * Publica un evento después del commit. Recibe una función que lo arma (lee la reserva), así cualquier falla,
 * al armarlo o al enviarlo a SQS, queda dentro del publicador. La implementación de producción nunca lanza:
 * registra `notification_publish_failed` y la operación del usuario sigue siendo válida (RN-07, SPEC §3.3).
 */
export type PublishEvent = (build: () => Promise<BookingEvent | null>) => Promise<void>;
