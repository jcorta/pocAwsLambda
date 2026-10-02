// Pila completa sin AWS: evento de API Gateway → router → handler → servicio → Postgres real.
// Cada respuesta se valida contra los esquemas del contrato (@reservas/shared).
import { Logger } from "@aws-lambda-powertools/logger";
import {
  AvailabilitySchema,
  BookingSchema,
  ErrorResponseSchema,
  MeSchema,
  paginated,
  ResourceSchema,
  SettingsSchema,
} from "@reservas/shared";
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_CLAIMS, bodyOf, httpEvent, type EventOptions } from "../../src/handlers/__fixtures__/events.ts";
import { createLambdaHandler } from "../../src/handlers/router.ts";
import { LAMBDA_ROUTES, type ApiLambdaName } from "../../src/handlers/routes/index.ts";
import { createDb } from "../../src/infra/db/client.ts";
import { noPublish, type ServiceDeps } from "../../src/services/context.ts";
import { startTestDatabase, type TestDatabase } from "../support/postgres.ts";

const NOW = Temporal.Instant.from("2026-10-02T12:00:00-03:00");
const logger = new Logger({ serviceName: "test", logLevel: "SILENT" });

let db: TestDatabase;
let deps: ServiceDeps;

beforeAll(async () => {
  db = await startTestDatabase();
  deps = { db: createDb(db.pool), now: () => NOW, timezone: "America/Argentina/Buenos_Aires", publishEvent: noPublish };
});
afterAll(async () => {
  await db?.stop();
});

async function call(lambda: ApiLambdaName, opts: EventOptions) {
  const handler = createLambdaHandler({
    routes: LAMBDA_ROUTES[lambda],
    getDeps: async () => deps,
    logger,
    requireAdmin: lambda === "admin",
  });
  const res = await handler(httpEvent(opts));
  return { status: res.statusCode, body: bodyOf(res) as Record<string, unknown> };
}

const userClaims = (sub = randomUUID()) => ({ sub, email: `${sub}@example.com`, token_use: "id" });
const admin = ADMIN_CLAIMS;

async function createResource(overrides: Record<string, unknown> = {}) {
  const res = await call("admin", {
    routeKey: "POST /v1/admin/resources",
    claims: admin,
    body: {
      name: `Sala ${randomUUID()}`,
      slotMinutes: 60,
      openingHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "12:00" })),
      ...overrides,
    },
  });
  expect(res.status).toBe(201);
  return ResourceSchema.parse(res.body);
}

describe("GET /v1/me", () => {
  it("devuelve id, email y roles", async () => {
    const claims = userClaims();
    const res = await call("me", { routeKey: "GET /v1/me", claims });
    expect(res.status).toBe(200);
    expect(MeSchema.parse(res.body)).toEqual({ id: claims.sub, email: claims.email, roles: ["user"] });
  });

  it("reconoce al admin", async () =>
    expect((await call("me", { routeKey: "GET /v1/me", claims: admin })).body).toMatchObject({ roles: ["admin"] }));
});

describe("recursos", () => {
  it("el admin crea un recurso (201) y un user no lo puede hacer (403)", async () => {
    const r = await createResource();
    expect(r.isActive).toBe(true);
    const forbidden = await call("admin", {
      routeKey: "POST /v1/admin/resources",
      claims: userClaims(),
      body: { name: "x", slotMinutes: 60, openingHours: [] },
    });
    expect(forbidden.status).toBe(403);
    ErrorResponseSchema.parse(forbidden.body);
  });

  it("valida el body con VALIDATION_ERROR y details.fields", async () => {
    const res = await call("admin", {
      routeKey: "POST /v1/admin/resources",
      claims: admin,
      body: { name: "", slotMinutes: 50, openingHours: [{ weekday: 9, opensAt: "8", closesAt: "10:00" }] },
    });
    expect(res.status).toBe(400);
    const paths = (ErrorResponseSchema.parse(res.body).error.details?.["fields"] as { path: string }[]).map(
      (f) => f.path,
    );
    expect(paths).toEqual(expect.arrayContaining(["name", "openingHours[0].weekday", "openingHours[0].opensAt"]));
  });

  it("un recurso inactivo desaparece para los users y sigue visible para el admin con includeInactive", async () => {
    const r = await createResource();
    const put = await call("admin", {
      routeKey: "PUT /v1/admin/resources/{id}",
      claims: admin,
      pathParameters: { id: r.id },
      body: { name: r.name, slotMinutes: 60, openingHours: r.openingHours, isActive: false },
    });
    expect(put.status).toBe(200);

    const asUser = await call("resources", { routeKey: "GET /v1/resources", claims: userClaims() });
    expect((asUser.body["items"] as { id: string }[]).map((i) => i.id)).not.toContain(r.id);
    const detail = await call("resources", {
      routeKey: "GET /v1/resources/{id}",
      claims: userClaims(),
      pathParameters: { id: r.id },
    });
    expect(detail.status).toBe(404);

    const asAdmin = await call("resources", {
      routeKey: "GET /v1/resources",
      claims: admin,
      queryStringParameters: { includeInactive: "true" },
    });
    expect((asAdmin.body["items"] as { id: string }[]).map((i) => i.id)).toContain(r.id);
  });

  it("un id que no es UUID responde 404", async () =>
    expect(
      (
        await call("resources", {
          routeKey: "GET /v1/resources/{id}",
          claims: userClaims(),
          pathParameters: { id: "abc" },
        })
      ).status,
    ).toBe(404));

  it("la disponibilidad cumple el contrato", async () => {
    const r = await createResource();
    const res = await call("resources", {
      routeKey: "GET /v1/resources/{id}/availability",
      claims: userClaims(),
      pathParameters: { id: r.id },
      queryStringParameters: { date: "2026-10-05" },
    });
    expect(res.status).toBe(200);
    const a = AvailabilitySchema.parse(res.body);
    expect(a.slots.map((s) => s.startsAt)).toEqual([
      "2026-10-05T08:00:00-03:00",
      "2026-10-05T09:00:00-03:00",
      "2026-10-05T10:00:00-03:00",
      "2026-10-05T11:00:00-03:00",
    ]);
  });

  it("la disponibilidad sin date responde VALIDATION_ERROR", async () => {
    const r = await createResource();
    const res = await call("resources", {
      routeKey: "GET /v1/resources/{id}/availability",
      claims: userClaims(),
      pathParameters: { id: r.id },
    });
    expect(res.status).toBe(400);
  });
});

describe("reservas", () => {
  it("reserva (201), lista en mis reservas y cancela (200), todo con el contrato", async () => {
    const r = await createResource();
    const claims = userClaims();
    const created = await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims,
      body: { resourceId: r.id, startsAt: "2026-10-05T10:00:00-03:00" },
    });
    expect(created.status).toBe(201);
    const booking = BookingSchema.parse(created.body);
    expect(booking).toMatchObject({
      resource: { id: r.id, name: r.name },
      startsAt: "2026-10-05T10:00:00-03:00",
      endsAt: "2026-10-05T11:00:00-03:00",
      status: "confirmed",
    });

    const mine = await call("bookings", { routeKey: "GET /v1/bookings/me", claims });
    expect(
      paginated(BookingSchema)
        .parse(mine.body)
        .items.map((b) => b.id),
    ).toEqual([booking.id]);

    const cancelled = await call("bookings", {
      routeKey: "POST /v1/bookings/{id}/cancel",
      claims,
      pathParameters: { id: booking.id },
    });
    expect(cancelled.status).toBe(200);
    expect(BookingSchema.parse(cancelled.body)).toMatchObject({ status: "cancelled", cancelledBy: "self" });
  });

  it("acepta startsAt con cualquier offset", async () => {
    const r = await createResource();
    const res = await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims: userClaims(),
      body: { resourceId: r.id, startsAt: "2026-10-05T13:00:00Z" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startsAt: "2026-10-05T10:00:00-03:00" });
  });

  it.each([
    [{ resourceId: "no-uuid", startsAt: "2026-10-05T10:00:00-03:00" }, "resourceId"],
    [{ resourceId: randomUUID(), startsAt: "2026-10-05T10:00:00" }, "startsAt"], // sin offset
  ])("valida el body %j", async (body, field) => {
    const res = await call("bookings", { routeKey: "POST /v1/bookings", claims: userClaims(), body });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
  });

  it("traduce las fallas de dominio a HTTP: SLOT_TAKEN 409 e INVALID_SLOT 400", async () => {
    const r = await createResource();
    const body = { resourceId: r.id, startsAt: "2026-10-06T09:00:00-03:00" };
    expect((await call("bookings", { routeKey: "POST /v1/bookings", claims: userClaims(), body })).status).toBe(201);
    const taken = await call("bookings", { routeKey: "POST /v1/bookings", claims: userClaims(), body });
    expect(taken.status).toBe(409);
    expect(ErrorResponseSchema.parse(taken.body).error).toMatchObject({ code: "SLOT_TAKEN", details: { mine: false } });
    const invalid = await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims: userClaims(),
      body: { resourceId: r.id, startsAt: "2026-10-06T09:30:00-03:00" },
    });
    expect(invalid.status).toBe(400);
  });

  it("pagina mis reservas con cursor, en orden ascendente para upcoming", async () => {
    const r = await createResource();
    const claims = userClaims();
    // Se sube el límite para poder crear 5 reservas activas
    await call("admin", {
      routeKey: "PUT /v1/admin/settings",
      claims: admin,
      body: { maxActiveBookingsPerUser: 10, cancellationMinHours: 2, bookingHorizonDays: 30 },
    });
    try {
      for (const day of ["05", "06", "07", "08", "09"]) {
        const res = await call("bookings", {
          routeKey: "POST /v1/bookings",
          claims,
          body: { resourceId: r.id, startsAt: `2026-10-${day}T08:00:00-03:00` },
        });
        expect(res.status).toBe(201);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await call("bookings", {
          routeKey: "GET /v1/bookings/me",
          claims,
          queryStringParameters: { limit: "2", ...(cursor ? { cursor } : {}) },
        });
        const page = paginated(BookingSchema).parse(res.body);
        seen.push(...page.items.map((b) => b.startsAt.slice(0, 10)));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    } finally {
      await call("admin", {
        routeKey: "PUT /v1/admin/settings",
        claims: admin,
        body: { maxActiveBookingsPerUser: 3, cancellationMinHours: 2, bookingHorizonDays: 30 },
      });
    }
  });

  it("mis reservas past incluye las canceladas, en orden descendente", async () => {
    const r = await createResource();
    const claims = userClaims();
    const ids: string[] = [];
    for (const day of ["05", "06"]) {
      const res = await call("bookings", {
        routeKey: "POST /v1/bookings",
        claims,
        body: { resourceId: r.id, startsAt: `2026-10-${day}T08:00:00-03:00` },
      });
      ids.push((res.body as { id: string }).id);
      await call("bookings", {
        routeKey: "POST /v1/bookings/{id}/cancel",
        claims,
        pathParameters: { id: ids.at(-1)! },
      });
    }
    const res = await call("bookings", {
      routeKey: "GET /v1/bookings/me",
      claims,
      queryStringParameters: { scope: "past" },
    });
    expect(
      paginated(BookingSchema)
        .parse(res.body)
        .items.map((b) => b.id),
    ).toEqual([ids[1], ids[0]]);
  });

  it("un cursor inválido responde VALIDATION_ERROR", async () =>
    expect(
      (
        await call("bookings", {
          routeKey: "GET /v1/bookings/me",
          claims: userClaims(),
          queryStringParameters: { cursor: "basura" },
        })
      ).status,
    ).toBe(400));
});

describe("admin: reservas y configuración", () => {
  it("lista todas las reservas con el titular y filtra por recurso, fecha, estado y email", async () => {
    const r = await createResource();
    const claims = userClaims();
    await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims,
      body: { resourceId: r.id, startsAt: "2026-10-07T09:00:00-03:00" },
    });
    await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims: userClaims(),
      body: { resourceId: r.id, startsAt: "2026-10-08T09:00:00-03:00" },
    });

    const list = (q: Record<string, string>) =>
      call("admin", {
        routeKey: "GET /v1/admin/bookings",
        claims: admin,
        queryStringParameters: { resourceId: r.id, ...q },
      });

    const all = paginated(BookingSchema).parse((await list({})).body);
    expect(all.items).toHaveLength(2);
    expect(all.items[0]!.user).toBeDefined();
    expect(all.items.map((b) => b.startsAt.slice(0, 10))).toEqual(["2026-10-08", "2026-10-07"]); // descendente

    expect(
      paginated(BookingSchema).parse((await list({ from: "2026-10-08", to: "2026-10-08" })).body).items,
    ).toHaveLength(1);
    expect(paginated(BookingSchema).parse((await list({ userEmail: claims.email })).body).items).toHaveLength(1);
    expect(paginated(BookingSchema).parse((await list({ status: "cancelled" })).body).items).toHaveLength(0);
  });

  it("el admin cancela la reserva de otro por la ruta de bookings y queda cancelledBy admin", async () => {
    const r = await createResource();
    const res = await call("bookings", {
      routeKey: "POST /v1/bookings",
      claims: userClaims(),
      body: { resourceId: r.id, startsAt: "2026-10-09T09:00:00-03:00" },
    });
    const id = (res.body as { id: string }).id;
    const cancelled = await call("bookings", {
      routeKey: "POST /v1/bookings/{id}/cancel",
      claims: admin,
      pathParameters: { id },
    });
    expect(BookingSchema.parse(cancelled.body)).toMatchObject({ status: "cancelled", cancelledBy: "admin" });
  });

  it("lee y modifica la configuración, y valida los valores", async () => {
    const get = await call("admin", { routeKey: "GET /v1/admin/settings", claims: admin });
    const current = SettingsSchema.parse(get.body);
    const bad = await call("admin", {
      routeKey: "PUT /v1/admin/settings",
      claims: admin,
      body: { ...current, cancellationMinHours: -1 },
    });
    expect(bad.status).toBe(400);
    const ok = await call("admin", {
      routeKey: "PUT /v1/admin/settings",
      claims: admin,
      body: {
        maxActiveBookingsPerUser: current.maxActiveBookingsPerUser,
        cancellationMinHours: current.cancellationMinHours,
        bookingHorizonDays: current.bookingHorizonDays,
      },
    });
    expect(ok.status).toBe(200);
    SettingsSchema.parse(ok.body);
  });
});
