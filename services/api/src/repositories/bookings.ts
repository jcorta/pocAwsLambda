import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import { toDate, type DbOrTx } from "../infra/db/client.ts";
import { bookings } from "../infra/db/schema.ts";

export type BookingRow = typeof bookings.$inferSelect;

/** Reservas activas: confirmadas y que todavía no empezaron (SPEC §2.2). */
export async function countActiveByUser(db: DbOrTx, userId: string, now: Temporal.Instant): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.userId, userId), eq(bookings.status, "confirmed"), gt(bookings.startsAt, toDate(now))));
  return row?.n ?? 0;
}

export async function insertBooking(
  tx: DbOrTx,
  values: { resourceId: string; userId: string; startsAt: Temporal.Instant; endsAt: Temporal.Instant },
): Promise<BookingRow> {
  const [row] = await tx
    .insert(bookings)
    .values({ ...values, startsAt: toDate(values.startsAt), endsAt: toDate(values.endsAt) })
    .returning();
  return row!;
}

/** Lee la reserva bloqueándola, para que dos cancelaciones simultáneas no pisen el estado. */
export async function findBookingForUpdate(tx: DbOrTx, id: string): Promise<BookingRow | null> {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
  return row ?? null;
}

export async function markCancelled(tx: DbOrTx, id: string, by: string, at: Temporal.Instant): Promise<BookingRow> {
  const [row] = await tx
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: toDate(at), cancelledBy: by, updatedAt: toDate(at) })
    .where(eq(bookings.id, id))
    .returning();
  return row!;
}

/** Reservas confirmadas de un recurso que se solapan con [from, to). */
export async function listConfirmedOverlapping(
  db: DbOrTx,
  resourceId: string,
  from: Temporal.Instant,
  to: Temporal.Instant,
): Promise<BookingRow[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.resourceId, resourceId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startsAt, toDate(to)),
        gt(bookings.endsAt, toDate(from)),
      ),
    );
}
