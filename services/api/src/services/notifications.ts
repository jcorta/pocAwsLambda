// Procesamiento de un evento en el notifier (SPEC §6.4): idempotente por event_id (CU-10).
import { and, eq } from "drizzle-orm";
import type { Db } from "../infra/db/client.ts";
import { notificationLog } from "../infra/db/schema.ts";
import type { BookingEvent } from "../notifications/event.ts";
import { renderEmail, type Email } from "../notifications/templates.ts";

export interface NotifierDeps {
  db: Db;
  timezone: string;
  sendEmail: (to: string, email: Email) => Promise<void>;
}

/**
 * 1. Registra el evento en notification_log (ON CONFLICT DO NOTHING). Si ya estaba, es un duplicado y se descarta.
 * 2. Envía el email.
 * 3. Si el envío falla, borra el registro y relanza el error, para que SQS reintente el mensaje.
 */
export async function processBookingEvent(deps: NotifierDeps, event: BookingEvent): Promise<"sent" | "duplicate"> {
  const inserted = await deps.db
    .insert(notificationLog)
    .values({ eventId: event.eventId, bookingId: event.booking.id, type: event.type })
    .onConflictDoNothing()
    .returning({ eventId: notificationLog.eventId });
  if (inserted.length === 0) return "duplicate";

  try {
    await deps.sendEmail(event.booking.userEmail, renderEmail(event, deps.timezone));
    return "sent";
  } catch (err) {
    await deps.db
      .delete(notificationLog)
      .where(and(eq(notificationLog.eventId, event.eventId), eq(notificationLog.type, event.type)));
    throw err;
  }
}
