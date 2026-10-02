// Lambda `resources` (SPEC §6.7): listado, detalle y disponibilidad.
import { AvailabilityQuerySchema, ResourcesQuerySchema } from "@reservas/shared";
import { Temporal } from "temporal-polyfill";
import { reject } from "../../domain/types.ts";
import { getResourceFor, listResourcesFor } from "../../services/queries.ts";
import { getAvailability } from "../../services/resources.ts";
import { errorResponse, json, parseQuery, pathId } from "../http.ts";
import type { Routes } from "../router.ts";
import { toAvailabilityDto, toResourceDto } from "../serializers.ts";

export const resourcesRoutes: Routes = {
  "GET /v1/resources": async ({ event, actor, deps, requestId }) => {
    const query = parseQuery(event, ResourcesQuerySchema);
    if (!query.ok) return errorResponse(query, requestId);
    const items = await listResourcesFor(deps, actor, query.data.includeInactive === "true");
    return json(
      200,
      { items: items.map((r) => toResourceDto(r, { isAdmin: actor.isAdmin, timezone: deps.timezone })) },
      requestId,
    );
  },

  "GET /v1/resources/{id}": async ({ event, actor, deps, requestId }) => {
    const id = pathId(event);
    if (!id) return errorResponse(reject("RESOURCE_NOT_FOUND"), requestId);
    const r = await getResourceFor(deps, actor, id);
    if (!r.ok) return errorResponse(r, requestId);
    return json(200, toResourceDto(r.value, { isAdmin: actor.isAdmin, timezone: deps.timezone }), requestId);
  },

  "GET /v1/resources/{id}/availability": async ({ event, actor, deps, requestId }) => {
    const id = pathId(event);
    if (!id) return errorResponse(reject("RESOURCE_NOT_FOUND"), requestId);
    const query = parseQuery(event, AvailabilityQuerySchema);
    if (!query.ok) return errorResponse(query, requestId);
    const r = await getAvailability(deps, actor, { resourceId: id, date: Temporal.PlainDate.from(query.data.date) });
    if (!r.ok) return errorResponse(r, requestId);
    return json(200, toAvailabilityDto(r.value), requestId);
  },
};
