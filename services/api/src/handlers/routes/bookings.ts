// Lambda `bookings` (SPEC §6.7): reservar, mis reservas y cancelar. Es la única que publica en SQS (F4).
import { CreateBookingSchema, MyBookingsQuerySchema } from "@reservas/shared";
import { Temporal } from "temporal-polyfill";
import { reject } from "../../domain/types.ts";
import { cancelBooking, reserveBooking } from "../../services/bookings.ts";
import type { RequestContext } from "../router.ts";
import { getBooking, listMyBookings } from "../../services/queries.ts";
import { errorResponse, json, parseBody, parseQuery, pathId } from "../http.ts";
import type { Routes } from "../router.ts";
import { toBookingDto } from "../serializers.ts";

/** Responde la reserva con los datos de la vista (nombre del recurso, etc.). */
async function bookingResponse(ctx: RequestContext, status: number, id: string) {
  const view = await getBooking(ctx.deps, id);
  if (!view) throw new Error(`La reserva ${id} desapareció después de escribirla`);
  return json(status, toBookingDto(view, { isAdmin: ctx.actor.isAdmin, timezone: ctx.deps.timezone }), ctx.requestId);
}

export const bookingsRoutes: Routes = {
  "POST /v1/bookings": async (ctx) => {
    const body = parseBody(ctx.event, CreateBookingSchema);
    if (!body.ok) return errorResponse(body, ctx.requestId);
    const r = await reserveBooking(ctx.deps, ctx.actor, {
      resourceId: body.data.resourceId,
      startsAt: Temporal.Instant.from(body.data.startsAt),
    });
    if (!r.ok) return errorResponse(r, ctx.requestId);
    return bookingResponse(ctx, 201, r.value.id);
  },

  "GET /v1/bookings/me": async ({ event, actor, deps, requestId }) => {
    const query = parseQuery(event, MyBookingsQuerySchema);
    if (!query.ok) return errorResponse(query, requestId);
    const r = await listMyBookings(deps, actor, query.data);
    if (!r.ok) return errorResponse(r, requestId);
    return json(
      200,
      {
        items: r.value.items.map((b) => toBookingDto(b, { isAdmin: false, timezone: deps.timezone })),
        nextCursor: r.value.nextCursor,
      },
      requestId,
    );
  },

  // El admin también cancela por esta ruta (SPEC §6.7)
  "POST /v1/bookings/{id}/cancel": async (ctx) => {
    const id = pathId(ctx.event);
    if (!id) return errorResponse(reject("BOOKING_NOT_FOUND"), ctx.requestId);
    const r = await cancelBooking(ctx.deps, ctx.actor, id);
    if (!r.ok) return errorResponse(r, ctx.requestId);
    return bookingResponse(ctx, 200, r.value.id);
  },
};
