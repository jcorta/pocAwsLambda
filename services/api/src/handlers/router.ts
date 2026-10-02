// Router mínimo por `routeKey` para las Lambdas de cada dominio (SPEC §6.7), sin frameworks.
import type { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";
import { reject } from "../domain/types.ts";
import type { Actor, ServiceDeps } from "../services/context.ts";
import { actorFromEvent } from "./auth.ts";
import { errorResponse, type HttpEvent, type HttpResult } from "./http.ts";

export interface RequestContext {
  event: HttpEvent;
  actor: Actor;
  deps: ServiceDeps;
  requestId: string;
}

export type RouteHandler = (ctx: RequestContext) => Promise<HttpResult>;
/** Mapa `routeKey` → handler, p. ej. `"POST /v1/bookings"`. Las claves son las rutas que declara Terraform. */
export type Routes = Record<string, RouteHandler>;

export function createLambdaHandler(options: {
  routes: Routes;
  /** Se resuelve una vez por contenedor (pool de pg, secreto de la DB) y se reutiliza en caliente. */
  getDeps: () => Promise<ServiceDeps>;
  logger: Logger;
  /** La Lambda `admin` valida el grupo una sola vez, antes de rutear (SPEC §6.7). */
  requireAdmin?: boolean;
}) {
  const { routes, getDeps, logger, requireAdmin = false } = options;

  return async (event: HttpEvent, context?: Pick<Context, "awsRequestId">): Promise<HttpResult> => {
    const requestId = context?.awsRequestId ?? event.requestContext.requestId;
    const started = Date.now();
    const log = (statusCode: number, userId?: string) =>
      logger.info("request", {
        requestId,
        routeKey: event.routeKey,
        statusCode,
        userId,
        durationMs: Date.now() - started,
      });

    const actor = actorFromEvent(event);
    if (!("userId" in actor)) {
      log(401);
      return errorResponse(actor, requestId);
    }
    if (requireAdmin && !actor.isAdmin) {
      log(403, actor.userId);
      return errorResponse(reject("FORBIDDEN"), requestId);
    }
    const route = routes[event.routeKey];
    if (!route) {
      log(404, actor.userId);
      return errorResponse(reject("ROUTE_NOT_FOUND"), requestId);
    }

    try {
      const result = await route({ event, actor, deps: await getDeps(), requestId });
      log(result.statusCode ?? 200, actor.userId);
      return result;
    } catch (err) {
      // Nunca se loguean tokens ni el body: solo el error y la ruta
      logger.error("unhandled error", { requestId, routeKey: event.routeKey, error: err as Error });
      return errorResponse(reject("INTERNAL_ERROR"), requestId);
    }
  };
}
