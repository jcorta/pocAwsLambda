// Lambda `admin` (SPEC §6.7): recursos, todas las reservas y configuración. El grupo admin
// se valida una sola vez en la entrada de la Lambda (createLambdaHandler con requireAdmin).
import {
  AdminBookingsQuerySchema,
  CreateResourceSchema,
  ReplaceResourceSchema,
  SettingsInputSchema,
} from "@reservas/shared";
import { Temporal } from "temporal-polyfill";
import { reject } from "../../domain/types.ts";
import { listAllBookings } from "../../services/queries.ts";
import { createResource, updateResource } from "../../services/resources.ts";
import { changeSettings, readSettings } from "../../services/settings.ts";
import { errorResponse, json, parseBody, parseQuery, pathId } from "../http.ts";
import type { Routes } from "../router.ts";
import { toBookingDto, toResourceDto, toSettingsDto } from "../serializers.ts";

const asAdmin = { isAdmin: true } as const;

export const adminRoutes: Routes = {
  "POST /v1/admin/resources": async ({ event, deps, requestId }) => {
    const body = parseBody(event, CreateResourceSchema);
    if (!body.ok) return errorResponse(body, requestId);
    const r = await createResource(deps, body.data);
    if (!r.ok) return errorResponse(r, requestId);
    return json(201, toResourceDto(r.value, { ...asAdmin, timezone: deps.timezone }), requestId);
  },

  "PUT /v1/admin/resources/{id}": async ({ event, deps, requestId }) => {
    const id = pathId(event);
    if (!id) return errorResponse(reject("RESOURCE_NOT_FOUND"), requestId);
    const body = parseBody(event, ReplaceResourceSchema);
    if (!body.ok) return errorResponse(body, requestId);
    const r = await updateResource(deps, id, body.data);
    if (!r.ok) return errorResponse(r, requestId);
    return json(200, toResourceDto(r.value, { ...asAdmin, timezone: deps.timezone }), requestId);
  },

  "GET /v1/admin/bookings": async ({ event, deps, requestId }) => {
    const query = parseQuery(event, AdminBookingsQuerySchema);
    if (!query.ok) return errorResponse(query, requestId);
    const { from, to, ...rest } = query.data;
    const r = await listAllBookings(deps, {
      ...rest,
      from: from ? Temporal.PlainDate.from(from) : undefined,
      to: to ? Temporal.PlainDate.from(to) : undefined,
    });
    if (!r.ok) return errorResponse(r, requestId);
    return json(
      200,
      {
        items: r.value.items.map((b) => toBookingDto(b, { ...asAdmin, timezone: deps.timezone })),
        nextCursor: r.value.nextCursor,
      },
      requestId,
    );
  },

  "GET /v1/admin/settings": async ({ deps, requestId }) =>
    json(200, toSettingsDto(await readSettings(deps), deps.timezone), requestId),

  "PUT /v1/admin/settings": async ({ event, deps, requestId }) => {
    const body = parseBody(event, SettingsInputSchema);
    if (!body.ok) return errorResponse(body, requestId);
    const r = await changeSettings(deps, body.data);
    if (!r.ok) return errorResponse(r, requestId);
    return json(200, toSettingsDto(r.value, deps.timezone), requestId);
  },
};
