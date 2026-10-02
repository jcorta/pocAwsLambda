// E2E de la API desplegada en Floci (SPEC §8.2): API Gateway con el JWT authorizer real, Lambdas,
// RDS y Cognito. Cada respuesta se valida contra el contrato (@reservas/shared), como test de contrato.
import {
  AvailabilitySchema,
  BookingSchema,
  ErrorResponseSchema,
  MeSchema,
  paginated,
  ResourceSchema,
} from "@reservas/shared";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALL_WEEK,
  api,
  capturedEmails,
  createUser,
  dayFromToday,
  FLOCI_URL,
  waitForEmail,
  type TestUser,
} from "./support.ts";

let admin: TestUser;

beforeAll(async () => {
  // Bandeja de SES vacía al empezar (SPEC §8.3). Los tests igual filtran por su propio usuario.
  await fetch(`${FLOCI_URL}/_aws/ses`, { method: "DELETE" });
  admin = await createUser({ admin: true });
});

async function newResource() {
  const res = await api("POST", "/v1/admin/resources", {
    token: admin.idToken,
    body: { name: `E2E ${randomUUID()}`, slotMinutes: 60, openingHours: ALL_WEEK },
  });
  expect(res.status).toBe(201);
  return ResourceSchema.parse(res.body);
}

async function slotsOf(resourceId: string, token: string, date: string) {
  const res = await api("GET", `/v1/resources/${resourceId}/availability?date=${date}`, { token });
  expect(res.status).toBe(200);
  return AvailabilitySchema.parse(res.body).slots;
}

const errorCode = (body: unknown) => ErrorResponseSchema.parse(body).error.code;

describe("autenticación y autorización", () => {
  it("sin token → 401 (lo responde API Gateway)", async () => {
    expect((await api("GET", "/v1/me")).status).toBe(401);
  });

  it("token con firma inválida → 401", async () => {
    expect((await api("GET", "/v1/me", { token: `${admin.idToken.slice(0, -6)}abcdef` })).status).toBe(401);
  });

  it("access token en lugar de ID token → 401 INVALID_TOKEN_TYPE (hallazgo A3)", async () => {
    const res = await api("GET", "/v1/me", { token: admin.accessToken });
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe("INVALID_TOKEN_TYPE");
  });

  it("un user en una ruta de admin → 403 FORBIDDEN", async () => {
    const user = await createUser();
    const res = await api("GET", "/v1/admin/settings", { token: user.idToken });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe("FORBIDDEN");
  });

  it("GET /v1/me devuelve el rol y el header x-request-id", async () => {
    const user = await createUser();
    const res = await api("GET", "/v1/me", { token: user.idToken });
    expect(MeSchema.parse(res.body)).toMatchObject({ email: user.email, roles: ["user"] });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(MeSchema.parse((await api("GET", "/v1/me", { token: admin.idToken })).body).roles).toEqual(["admin"]);
  });

  it("CORS: el preflight desde el frontend local devuelve el origen permitido", async () => {
    const res = await api("OPTIONS", "/v1/me", {
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("flujo de reserva (CU-02 a CU-06)", () => {
  it("el admin crea un recurso; el usuario consulta la disponibilidad, reserva, lo ve en mis reservas y cancela", async () => {
    const resource = await newResource();
    const user = await createUser();

    const list = z
      .object({ items: z.array(ResourceSchema) })
      .parse((await api("GET", "/v1/resources", { token: user.idToken })).body);
    expect(list.items.map((r) => r.id)).toContain(resource.id);
    // A un user no se le muestran isActive ni las fechas de auditoría (SPEC §4.4)
    expect(list.items[0]).not.toHaveProperty("isActive");

    const date = dayFromToday(2);
    const slots = await slotsOf(resource.id, user.idToken, date);
    expect(slots.map((s) => s.status)).toEqual(["available", "available", "available", "available"]);

    const created = await api("POST", "/v1/bookings", {
      token: user.idToken,
      body: { resourceId: resource.id, startsAt: slots[1]!.startsAt },
    });
    expect(created.status).toBe(201);
    const booking = BookingSchema.parse(created.body);
    expect(booking).toMatchObject({ resource: { id: resource.id }, startsAt: slots[1]!.startsAt, status: "confirmed" });

    expect((await slotsOf(resource.id, user.idToken, date))[1]).toMatchObject({ status: "booked", mine: true });

    const mine = paginated(BookingSchema).parse((await api("GET", "/v1/bookings/me", { token: user.idToken })).body);
    expect(mine.items.map((b) => b.id)).toContain(booking.id);

    const cancelled = await api("POST", `/v1/bookings/${booking.id}/cancel`, { token: user.idToken });
    expect(cancelled.status).toBe(200);
    expect(BookingSchema.parse(cancelled.body)).toMatchObject({ status: "cancelled", cancelledBy: "self" });
    expect((await slotsOf(resource.id, user.idToken, date))[1]).toMatchObject({ status: "available" });
  });

  it("dos usuarios distintos contra el mismo turno: el segundo recibe 409 SLOT_TAKEN", async () => {
    const resource = await newResource();
    const [a, b] = await Promise.all([createUser(), createUser()]);
    const startsAt = (await slotsOf(resource.id, a.idToken, dayFromToday(3)))[0]!.startsAt;

    expect(
      (await api("POST", "/v1/bookings", { token: a.idToken, body: { resourceId: resource.id, startsAt } })).status,
    ).toBe(201);
    const taken = await api("POST", "/v1/bookings", { token: b.idToken, body: { resourceId: resource.id, startsAt } });
    expect(taken.status).toBe(409);
    expect(ErrorResponseSchema.parse(taken.body).error).toMatchObject({ code: "SLOT_TAKEN", details: { mine: false } });
  });

  it("con 3 reservas activas, la cuarta recibe 409 BOOKING_LIMIT_REACHED (RN-05)", async () => {
    const resource = await newResource();
    const user = await createUser();
    const slots = await slotsOf(resource.id, user.idToken, dayFromToday(4));
    for (const slot of slots.slice(0, 3)) {
      const r = await api("POST", "/v1/bookings", {
        token: user.idToken,
        body: { resourceId: resource.id, startsAt: slot.startsAt },
      });
      expect(r.status).toBe(201);
    }
    const fourth = await api("POST", "/v1/bookings", {
      token: user.idToken,
      body: { resourceId: resource.id, startsAt: slots[3]!.startsAt },
    });
    expect(fourth.status).toBe(409);
    expect(ErrorResponseSchema.parse(fourth.body).error).toMatchObject({
      code: "BOOKING_LIMIT_REACHED",
      details: { limit: 3 },
    });
  });

  it("el admin cancela la reserva de un usuario y ve al titular en el listado de admin", async () => {
    const resource = await newResource();
    const user = await createUser();
    const startsAt = (await slotsOf(resource.id, user.idToken, dayFromToday(5)))[2]!.startsAt;
    const booking = BookingSchema.parse(
      (await api("POST", "/v1/bookings", { token: user.idToken, body: { resourceId: resource.id, startsAt } })).body,
    );

    const cancelled = await api("POST", `/v1/bookings/${booking.id}/cancel`, { token: admin.idToken });
    expect(BookingSchema.parse(cancelled.body)).toMatchObject({ status: "cancelled", cancelledBy: "admin" });

    const all = paginated(BookingSchema).parse(
      (await api("GET", `/v1/admin/bookings?resourceId=${resource.id}`, { token: admin.idToken })).body,
    );
    expect(all.items[0]).toMatchObject({ id: booking.id, user: { email: user.email } });
  });

  it("un user no puede cancelar la reserva de otro: 404 BOOKING_NOT_FOUND", async () => {
    const resource = await newResource();
    const [owner, other] = await Promise.all([createUser(), createUser()]);
    const startsAt = (await slotsOf(resource.id, owner.idToken, dayFromToday(6)))[0]!.startsAt;
    const booking = BookingSchema.parse(
      (await api("POST", "/v1/bookings", { token: owner.idToken, body: { resourceId: resource.id, startsAt } })).body,
    );
    const res = await api("POST", `/v1/bookings/${booking.id}/cancel`, { token: other.idToken });
    expect(res.status).toBe(404);
    expect(errorCode(res.body)).toBe("BOOKING_NOT_FOUND");
  });

  it("errores de validación y de dominio con su HTTP: 400 VALIDATION_ERROR, 400 INVALID_SLOT y 400 DATE_OUT_OF_RANGE", async () => {
    const resource = await newResource();
    const user = await createUser();
    const send = (body: unknown) => api("POST", "/v1/bookings", { token: user.idToken, body });

    const invalidBody = await send({ resourceId: resource.id });
    expect([invalidBody.status, errorCode(invalidBody.body)]).toEqual([400, "VALIDATION_ERROR"]);

    const misaligned = await send({ resourceId: resource.id, startsAt: `${dayFromToday(2)}T08:30:00-03:00` });
    expect([misaligned.status, errorCode(misaligned.body)]).toEqual([400, "INVALID_SLOT"]);

    const tooFar = await send({ resourceId: resource.id, startsAt: `${dayFromToday(45)}T08:00:00-03:00` });
    expect([tooFar.status, errorCode(tooFar.body)]).toEqual([400, "DATE_OUT_OF_RANGE"]);
  });
});

describe("notificaciones por email (CU-10): bookings → SQS → notifier → SES", () => {
  it("reservar y cancelar envían un email cada uno al titular, sin duplicados", async () => {
    const resource = await newResource();
    const user = await createUser();
    const startsAt = (await slotsOf(resource.id, user.idToken, dayFromToday(7)))[1]!.startsAt;
    const booking = BookingSchema.parse(
      (await api("POST", "/v1/bookings", { token: user.idToken, body: { resourceId: resource.id, startsAt } })).body,
    );

    const confirmed = await waitForEmail(user.email, (m) => m.Subject === `Reserva confirmada: ${resource.name}`);
    expect(confirmed.Body.text_part).toContain("Tu reserva quedó confirmada.");
    expect(confirmed.Body.text_part).toMatch(/de 09:00 a 10:00/);

    await api("POST", `/v1/bookings/${booking.id}/cancel`, { token: user.idToken });
    const cancelled = await waitForEmail(user.email, (m) => m.Subject === `Reserva cancelada: ${resource.name}`);
    expect(cancelled.Body.text_part).toContain("Cancelaste tu reserva.");

    // Un email por evento: ni la entrega "al menos una vez" de SQS ni los reintentos los duplican
    expect((await capturedEmails(user.email)).map((m) => m.Subject).sort()).toEqual([
      `Reserva cancelada: ${resource.name}`,
      `Reserva confirmada: ${resource.name}`,
    ]);
  });

  it("si cancela un admin, el email lo dice", async () => {
    const resource = await newResource();
    const user = await createUser();
    const startsAt = (await slotsOf(resource.id, user.idToken, dayFromToday(8)))[0]!.startsAt;
    const booking = BookingSchema.parse(
      (await api("POST", "/v1/bookings", { token: user.idToken, body: { resourceId: resource.id, startsAt } })).body,
    );
    await api("POST", `/v1/bookings/${booking.id}/cancel`, { token: admin.idToken });
    const email = await waitForEmail(user.email, (m) => m.Subject.startsWith("Reserva cancelada"));
    expect(email.Body.text_part).toContain("Un administrador canceló tu reserva.");
  });
});
