// Lecturas de reservas con los datos que necesita la API (nombre del recurso y email del titular),
// y listados con paginación por cursor (SPEC §4.1).
import { and, asc, desc, eq, gt, gte, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import { toDate, type DbOrTx } from "../infra/db/client.ts";
import { bookings, resources, users } from "../infra/db/schema.ts";

export interface BookingView {
  id: string;
  resourceId: string;
  resourceName: string;
  userId: string;
  userEmail: string;
  startsAt: Date;
  endsAt: Date;
  status: "confirmed" | "cancelled";
  createdAt: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
}

/** Posición en un listado ordenado por (starts_at, id). Viaja al cliente como cursor opaco. */
export interface Cursor {
  startsAt: Date;
  id: string;
}

const viewColumns = {
  id: bookings.id,
  resourceId: bookings.resourceId,
  resourceName: resources.name,
  userId: bookings.userId,
  userEmail: users.email,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  status: bookings.status,
  createdAt: bookings.createdAt,
  cancelledAt: bookings.cancelledAt,
  cancelledBy: bookings.cancelledBy,
};

function baseQuery(db: DbOrTx) {
  return db
    .select(viewColumns)
    .from(bookings)
    .innerJoin(resources, eq(resources.id, bookings.resourceId))
    .innerJoin(users, eq(users.id, bookings.userId));
}

export async function getBookingView(db: DbOrTx, id: string): Promise<BookingView | null> {
  const [row] = await baseQuery(db).where(eq(bookings.id, id));
  return row ?? null;
}

export interface ListFilter {
  userId?: string;
  resourceId?: string;
  status?: "confirmed" | "cancelled";
  userEmail?: string;
  /** Inicio en [from, to) */
  from?: Temporal.Instant;
  to?: Temporal.Instant;
  /** Mis reservas: `upcoming` = confirmadas futuras; `past` = pasadas o canceladas (SPEC §4.5). */
  scope?: { kind: "upcoming" | "past"; now: Temporal.Instant };
}

export async function listBookingViews(
  db: DbOrTx,
  filter: ListFilter,
  page: { limit: number; cursor?: Cursor; order: "asc" | "desc" },
): Promise<{ items: BookingView[]; next: Cursor | null }> {
  const conditions: (SQL | undefined)[] = [
    filter.userId ? eq(bookings.userId, filter.userId) : undefined,
    filter.resourceId ? eq(bookings.resourceId, filter.resourceId) : undefined,
    filter.status ? eq(bookings.status, filter.status) : undefined,
    filter.userEmail ? eq(users.email, filter.userEmail) : undefined,
    filter.from ? gte(bookings.startsAt, toDate(filter.from)) : undefined,
    filter.to ? lt(bookings.startsAt, toDate(filter.to)) : undefined,
  ];
  if (filter.scope?.kind === "upcoming") {
    conditions.push(eq(bookings.status, "confirmed"), gt(bookings.startsAt, toDate(filter.scope.now)));
  } else if (filter.scope?.kind === "past") {
    conditions.push(or(eq(bookings.status, "cancelled"), lte(bookings.startsAt, toDate(filter.scope.now))));
  }
  if (page.cursor) {
    // Paginación por clave (keyset): estable aunque se inserten reservas entre una página y otra
    const op = page.order === "asc" ? sql`>` : sql`<`;
    conditions.push(sql`(${bookings.startsAt}, ${bookings.id}) ${op} (${page.cursor.startsAt}, ${page.cursor.id})`);
  }

  const dir = page.order === "asc" ? asc : desc;
  const rows = await baseQuery(db)
    .where(and(...conditions))
    .orderBy(dir(bookings.startsAt), dir(bookings.id))
    .limit(page.limit + 1);

  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return { items, next: rows.length > page.limit && last ? { startsAt: last.startsAt, id: last.id } : null };
}
