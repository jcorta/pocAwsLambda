// Consultas de lectura: recursos (CU-02), reservas propias (CU-05) y todas las reservas (CU-08, admin).
import { Temporal } from "temporal-polyfill";
import { reject } from "../domain/types.ts";
import { getBookingView, listBookingViews, type BookingView, type Cursor } from "../repositories/booking-views.ts";
import { getResource, listResources, type Resource } from "../repositories/resources.ts";
import { success, type Actor, type ServiceDeps, type ServiceResult } from "./context.ts";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** El cursor es opaco para el cliente: base64url de la posición en el listado. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.startsAt.toISOString(), i: cursor.id })).toString("base64url");
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const { s, i } = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { s?: unknown; i?: unknown };
    if (typeof s !== "string" || typeof i !== "string") return null;
    const startsAt = new Date(s);
    return Number.isNaN(startsAt.getTime()) ? null : { startsAt, id: i };
  } catch {
    return null;
  }
}

const invalidCursor = () => reject("VALIDATION_ERROR", { fields: [{ path: "cursor", message: "Cursor inválido" }] });

/** CU-02: un `user` ve solo los activos; un admin puede pedir también los inactivos. */
export function listResourcesFor(deps: ServiceDeps, actor: Actor, includeInactive: boolean): Promise<Resource[]> {
  return listResources(deps.db, { includeInactive: actor.isAdmin && includeInactive });
}

/** Un recurso inactivo no existe para un `user` (SPEC §4.3). */
export async function getResourceFor(deps: ServiceDeps, actor: Actor, id: string): Promise<ServiceResult<Resource>> {
  const resource = await getResource(deps.db, id);
  if (!resource || (!resource.isActive && !actor.isAdmin)) return reject("RESOURCE_NOT_FOUND");
  return success(resource);
}

export async function getBooking(deps: ServiceDeps, id: string): Promise<BookingView | null> {
  return getBookingView(deps.db, id);
}

/** CU-05: `upcoming` en orden ascendente por inicio; `past` (pasadas o canceladas) en orden descendente. */
export async function listMyBookings(
  deps: ServiceDeps,
  actor: Actor,
  query: { scope: "upcoming" | "past"; limit: number; cursor?: string | undefined },
): Promise<ServiceResult<Page<BookingView>>> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor === null) return invalidCursor();
  const { items, next } = await listBookingViews(
    deps.db,
    { userId: actor.userId, scope: { kind: query.scope, now: deps.now() } },
    { limit: query.limit, ...(cursor ? { cursor } : {}), order: query.scope === "upcoming" ? "asc" : "desc" },
  );
  return success({ items, nextCursor: next ? encodeCursor(next) : null });
}

/** CU-08: todas las reservas, filtrables. `from` y `to` son fechas de APP_TIMEZONE, ambas inclusive. */
export async function listAllBookings(
  deps: ServiceDeps,
  query: {
    limit: number;
    cursor?: string | undefined;
    resourceId?: string | undefined;
    status?: "confirmed" | "cancelled" | undefined;
    userEmail?: string | undefined;
    from?: Temporal.PlainDate | undefined;
    to?: Temporal.PlainDate | undefined;
  },
): Promise<ServiceResult<Page<BookingView>>> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor === null) return invalidCursor();
  const startOf = (d: Temporal.PlainDate) => d.toZonedDateTime({ timeZone: deps.timezone }).toInstant();
  const { items, next } = await listBookingViews(
    deps.db,
    {
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.userEmail ? { userEmail: query.userEmail } : {}),
      ...(query.from ? { from: startOf(query.from) } : {}),
      ...(query.to ? { to: startOf(query.to.add({ days: 1 })) } : {}),
    },
    { limit: query.limit, ...(cursor ? { cursor } : {}), order: "desc" },
  );
  return success({ items, nextCursor: next ? encodeCursor(next) : null });
}
