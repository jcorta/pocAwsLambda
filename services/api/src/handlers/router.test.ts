import { Logger } from "@aws-lambda-powertools/logger";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import { noPublish, type ServiceDeps } from "../services/context.ts";
import { ADMIN_CLAIMS, bodyOf, httpEvent } from "./__fixtures__/events.ts";
import { json } from "./http.ts";
import { createLambdaHandler } from "./router.ts";

const deps = {
  db: {} as never,
  now: () => Temporal.Now.instant(),
  timezone: "UTC",
  publishEvent: noPublish,
} satisfies ServiceDeps;
const logger = new Logger({ serviceName: "test", logLevel: "SILENT" });

const handlerWith = (opts: { requireAdmin?: boolean; fail?: boolean } = {}) =>
  createLambdaHandler({
    routes: {
      "GET /v1/ping": async ({ actor, requestId }) => {
        if (opts.fail) throw new Error("boom");
        return json(200, { userId: actor.userId }, requestId);
      },
    },
    getDeps: async () => deps,
    logger,
    ...(opts.requireAdmin ? { requireAdmin: true } : {}),
  });

describe("createLambdaHandler", () => {
  it("rutea por routeKey y propaga el requestId de Lambda", async () => {
    const res = await handlerWith()(httpEvent({ routeKey: "GET /v1/ping" }), { awsRequestId: "aws-1" });
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ userId: "user-1" });
    expect(res.headers?.["x-request-id"]).toBe("aws-1");
  });

  it("responde 404 ROUTE_NOT_FOUND para un routeKey que no conoce", async () => {
    const res = await handlerWith()(httpEvent({ routeKey: "GET /v1/otra" }));
    expect(res.statusCode).toBe(404);
    expect(bodyOf(res)).toMatchObject({ error: { code: "ROUTE_NOT_FOUND" } });
  });

  it("responde 401 INVALID_TOKEN_TYPE con un access token", async () => {
    const res = await handlerWith()(
      httpEvent({ routeKey: "GET /v1/ping", claims: { sub: "user-1", token_use: "access" } }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("con requireAdmin responde 403 FORBIDDEN a un user, antes de rutear", async () => {
    const res = await handlerWith({ requireAdmin: true })(httpEvent({ routeKey: "GET /v1/otra" }));
    expect(res.statusCode).toBe(403);
    expect(bodyOf(res)).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("con requireAdmin deja pasar al admin", async () => {
    const res = await handlerWith({ requireAdmin: true })(
      httpEvent({ routeKey: "GET /v1/ping", claims: ADMIN_CLAIMS }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("un error inesperado responde 500 INTERNAL_ERROR y se loguea", async () => {
    const spy = vi.spyOn(logger, "error");
    const res = await handlerWith({ fail: true })(httpEvent({ routeKey: "GET /v1/ping" }));
    expect(res.statusCode).toBe(500);
    expect(bodyOf(res)).toMatchObject({ error: { code: "INTERNAL_ERROR", requestId: "req-1" } });
    expect(spy).toHaveBeenCalledOnce();
  });
});
