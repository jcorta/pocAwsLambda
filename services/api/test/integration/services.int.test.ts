import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpeningHours } from "../../src/domain/types.ts";
import { createDb } from "../../src/infra/db/client.ts";
import { cancelBooking, reserveBooking } from "../../src/services/bookings.ts";
import type { Actor, ServiceDeps } from "../../src/services/context.ts";
import { createResource, getAvailability, updateResource } from "../../src/services/resources.ts";
import { changeSettings, readSettings } from "../../src/services/settings.ts";
import { startTestDatabase, type TestDatabase } from "../support/postgres.ts";

const TZ = "America/Argentina/Buenos_Aires";
// Viernes 2 de octubre de 2026, 12:00 en Buenos Aires
const NOW = Temporal.Instant.from("2026-10-02T12:00:00-03:00");
const at = (iso: string) => Temporal.Instant.from(iso);
const allWeek = (opensAt = "08:00", closesAt = "20:00"): OpeningHours[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

let db: TestDatabase;
let deps: ServiceDeps;
const depsAt = (now: Temporal.Instant): ServiceDeps => ({ ...deps, now: () => now });

const user = (isAdmin = false): Actor => {
  const id = randomUUID();
  return { userId: id, email: `${id}@example.com`, isAdmin };
};

async function newResource(slotMinutes = 60, openingHours = allWeek()) {
  const r = await createResource(deps, { name: `Recurso ${randomUUID()}`, slotMinutes, openingHours });
  if (!r.ok) throw new Error(`no se pudo crear el recurso: ${r.code}`);
  return r.value;
}

beforeAll(async () => {
  db = await startTestDatabase();
  deps = { db: createDb(db.pool), now: () => NOW, timezone: TZ };
});

afterAll(async () => {
  await db?.stop();
});

describe("reserveBooking (CU-04)", () => {
  it("reserva un turno válido y calcula endsAt en el servidor", async () => {
    const resource = await newResource();
    const r = await reserveBooking(deps, user(), {
      resourceId: resource.id,
      startsAt: at("2026-10-05T10:00:00-03:00"),
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.endsAt.toISOString()).toBe("2026-10-05T14:00:00.000Z");
    expect(r.ok && r.value.status).toBe("confirmed");
  });

  it("RN-01 bajo concurrencia: 20 usuarios contra el mismo turno → exactamente 1 éxito y 19 SLOT_TAKEN", async () => {
    const resource = await newResource();
    const startsAt = at("2026-10-06T10:00:00-03:00");
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveBooking(deps, user(), { resourceId: resource.id, startsAt })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failures = results.filter((r) => !r.ok);
    expect(failures).toHaveLength(19);
    for (const f of failures) expect(f).toEqual({ ok: false, code: "SLOT_TAKEN", details: { mine: false } });
  });

  it("RN-05 bajo concurrencia: el mismo usuario hace 6 reservas en paralelo con límite 3 → exactamente 3 éxitos", async () => {
    const resource = await newResource();
    const actor = user();
    const results = await Promise.all(
      [8, 9, 10, 11, 12, 13].map((h) =>
        reserveBooking(deps, actor, {
          resourceId: resource.id,
          startsAt: at(`2026-10-07T${String(h).padStart(2, "0")}:00:00-03:00`),
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    for (const f of results.filter((r) => !r.ok)) {
      expect(f).toEqual({ ok: false, code: "BOOKING_LIMIT_REACHED", details: { limit: 3 } });
    }
  });

  it("informa mine: true si el turno ya lo tiene el mismo usuario", async () => {
    const resource = await newResource();
    const actor = user();
    const startsAt = at("2026-10-08T10:00:00-03:00");
    await reserveBooking(deps, actor, { resourceId: resource.id, startsAt });
    expect(await reserveBooking(deps, actor, { resourceId: resource.id, startsAt })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
      details: { mine: true },
    });
  });

  it("el admin no tiene límite de reservas activas", async () => {
    const resource = await newResource();
    const admin = user(true);
    const results = [];
    for (const h of [8, 9, 10, 11]) {
      results.push(
        await reserveBooking(deps, admin, {
          resourceId: resource.id,
          startsAt: at(`2026-10-09T${`0${h}`.slice(-2)}:00:00-03:00`),
        }),
      );
    }
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("las reservas pasadas y canceladas no cuentan para el límite", async () => {
    const resource = await newResource();
    const actor = user();
    const past = await reserveBooking(depsAt(at("2026-10-01T12:00:00-03:00")), actor, {
      resourceId: resource.id,
      startsAt: at("2026-10-02T09:00:00-03:00"), // ya pasó respecto de NOW
    });
    expect(past.ok).toBe(true);
    const toCancel = await reserveBooking(deps, actor, {
      resourceId: resource.id,
      startsAt: at("2026-10-10T08:00:00-03:00"),
    });
    if (!toCancel.ok) throw new Error(toCancel.code);
    await cancelBooking(deps, actor, toCancel.value.id);
    for (const h of [9, 10, 11]) {
      expect(
        (
          await reserveBooking(deps, actor, {
            resourceId: resource.id,
            startsAt: at(`2026-10-10T${`0${h}`.slice(-2)}:00:00-03:00`),
          })
        ).ok,
      ).toBe(true);
    }
  });

  it("rechaza un recurso inactivo con RESOURCE_NOT_FOUND, también al admin (RN-04)", async () => {
    const resource = await newResource();
    await updateResource(deps, resource.id, { ...resource, isActive: false });
    for (const actor of [user(), user(true)]) {
      expect(
        await reserveBooking(deps, actor, { resourceId: resource.id, startsAt: at("2026-10-05T10:00:00-03:00") }),
      ).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" });
    }
  });

  it("rechaza un recurso inexistente", async () =>
    expect(
      await reserveBooking(deps, user(), { resourceId: randomUUID(), startsAt: at("2026-10-05T10:00:00-03:00") }),
    ).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" }));

  it("propaga los errores de dominio: turno desalineado (INVALID_SLOT) y fuera del horizonte (DATE_OUT_OF_RANGE)", async () => {
    const resource = await newResource();
    expect(
      await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-05T10:30:00-03:00") }),
    ).toMatchObject({ code: "INVALID_SLOT" });
    expect(
      await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-11-02T10:00:00-03:00") }),
    ).toMatchObject({ code: "DATE_OUT_OF_RANGE" });
  });

  it("RN-08: una reserva de 60 min impide reservar 10:30 si el recurso pasa a turnos de 30", async () => {
    const resource = await newResource(60);
    expect(
      (await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-12T10:00:00-03:00") })).ok,
    ).toBe(true);
    const updated = await updateResource(deps, resource.id, { ...resource, slotMinutes: 30 });
    expect(updated.ok).toBe(true);
    expect(
      await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-12T10:30:00-03:00") }),
    ).toMatchObject({ ok: false, code: "SLOT_TAKEN" });
    expect(
      (await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-12T11:00:00-03:00") })).ok,
    ).toBe(true);
  });
});

describe("cancelBooking (CU-06)", () => {
  async function reserved(startsAt = "2026-10-05T10:00:00-03:00") {
    const resource = await newResource();
    const owner = user();
    const r = await reserveBooking(deps, owner, { resourceId: resource.id, startsAt: at(startsAt) });
    if (!r.ok) throw new Error(r.code);
    return { resource, owner, booking: r.value };
  }

  it("cancela, registra quién y cuándo, y libera el turno para otro usuario", async () => {
    const { resource, owner, booking } = await reserved();
    const r = await cancelBooking(deps, owner, booking.id);
    expect(r.ok && r.value).toMatchObject({ status: "cancelled", cancelledBy: owner.userId });
    expect(r.ok && r.value.cancelledAt?.toISOString()).toBe(new Date(NOW.epochMilliseconds).toISOString());
    expect(
      (await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-05T10:00:00-03:00") })).ok,
    ).toBe(true);
  });

  it("rechaza dentro de la ventana de anticipación y permite el borde exacto (RN-06)", async () => {
    const a = await reserved("2026-10-05T10:00:00-03:00");
    expect(await cancelBooking(depsAt(at("2026-10-05T08:01:00-03:00")), a.owner, a.booking.id)).toMatchObject({
      code: "CANCELLATION_WINDOW_CLOSED",
    });
    expect((await cancelBooking(depsAt(at("2026-10-05T08:00:00-03:00")), a.owner, a.booking.id)).ok).toBe(true);
  });

  it("un user no puede cancelar la reserva de otro: BOOKING_NOT_FOUND", async () => {
    const { booking } = await reserved();
    expect(await cancelBooking(deps, user(), booking.id)).toMatchObject({ code: "BOOKING_NOT_FOUND" });
  });

  it("el admin cancela cualquier reserva sin restricción de anticipación, aunque nunca haya reservado", async () => {
    const { booking } = await reserved();
    const admin = user(true);
    const r = await cancelBooking(depsAt(at("2026-10-05T09:50:00-03:00")), admin, booking.id);
    expect(r.ok && r.value.cancelledBy).toBe(admin.userId);
  });

  it("rechaza una reserva ya cancelada o inexistente", async () => {
    const { owner, booking } = await reserved();
    await cancelBooking(deps, owner, booking.id);
    expect(await cancelBooking(deps, owner, booking.id)).toMatchObject({ code: "BOOKING_ALREADY_CANCELLED" });
    expect(await cancelBooking(deps, owner, randomUUID())).toMatchObject({ code: "BOOKING_NOT_FOUND" });
  });

  it("dos cancelaciones simultáneas: una gana y la otra ve BOOKING_ALREADY_CANCELLED", async () => {
    const { owner, booking } = await reserved();
    const results = await Promise.all([cancelBooking(deps, owner, booking.id), cancelBooking(deps, owner, booking.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "BOOKING_ALREADY_CANCELLED" });
  });
});

describe("recursos (CU-07)", () => {
  it("rechaza un nombre duplicado con RESOURCE_NAME_TAKEN", async () => {
    const name = `Sala ${randomUUID()}`;
    await createResource(deps, { name, slotMinutes: 60, openingHours: [] });
    expect(await createResource(deps, { name, slotMinutes: 60, openingHours: [] })).toEqual({
      ok: false,
      code: "RESOURCE_NAME_TAKEN",
    });
  });

  it("rechaza un horario inválido con VALIDATION_ERROR y el detalle por campo", async () => {
    const r = await createResource(deps, {
      name: `Sala ${randomUUID()}`,
      slotMinutes: 90,
      openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "10:00" }],
    });
    expect(r).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
      details: { fields: [{ path: "openingHours[0]" }] },
    });
  });

  it("devuelve el horario en formato HH:mm y reemplaza el recurso completo", async () => {
    const resource = await newResource(60, [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }]);
    expect(resource.openingHours).toEqual([{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }]);
    const r = await updateResource(deps, resource.id, {
      ...resource,
      description: "Renovada",
      openingHours: [{ weekday: 2, opensAt: "09:00", closesAt: "11:00" }],
    });
    expect(r.ok && r.value).toMatchObject({
      description: "Renovada",
      openingHours: [{ weekday: 2, opensAt: "09:00", closesAt: "11:00" }],
    });
  });

  it("updateResource de un recurso inexistente responde RESOURCE_NOT_FOUND", async () =>
    expect(await updateResource(deps, randomUUID(), { name: "x", slotMinutes: 60, openingHours: [] })).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    }));
});

describe("getAvailability (CU-03)", () => {
  it("devuelve los turnos del día con su estado y mine", async () => {
    const resource = await newResource(60, allWeek("10:00", "13:00"));
    const me = user();
    await reserveBooking(deps, me, { resourceId: resource.id, startsAt: at("2026-10-05T10:00:00-03:00") });
    await reserveBooking(deps, user(), { resourceId: resource.id, startsAt: at("2026-10-05T11:00:00-03:00") });

    const r = await getAvailability(deps, me, { resourceId: resource.id, date: Temporal.PlainDate.from("2026-10-05") });
    expect(r.ok && r.value.slots.map((s) => [s.status, s.mine])).toEqual([
      ["booked", true],
      ["booked", false],
      ["available", false],
    ]);
  });

  it("marca como past los turnos de hoy que ya empezaron", async () => {
    const resource = await newResource(60, allWeek("10:00", "14:00"));
    const r = await getAvailability(deps, user(), {
      resourceId: resource.id,
      date: Temporal.PlainDate.from("2026-10-02"),
    });
    expect(r.ok && r.value.slots.map((s) => s.status)).toEqual(["past", "past", "past", "available"]);
  });

  it("oculta un recurso inactivo a los users pero no al admin", async () => {
    const resource = await newResource();
    await updateResource(deps, resource.id, { ...resource, isActive: false });
    const date = Temporal.PlainDate.from("2026-10-05");
    expect(await getAvailability(deps, user(), { resourceId: resource.id, date })).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    expect((await getAvailability(deps, user(true), { resourceId: resource.id, date })).ok).toBe(true);
  });

  it("rechaza una fecha fuera del horizonte", async () => {
    const resource = await newResource();
    expect(
      await getAvailability(deps, user(), { resourceId: resource.id, date: Temporal.PlainDate.from("2026-10-01") }),
    ).toMatchObject({ code: "DATE_OUT_OF_RANGE" });
  });
});

describe("settings (CU-09)", () => {
  it("valida y aplica los cambios a las operaciones siguientes", async () => {
    const original = await readSettings(deps);
    expect(original).toEqual({ maxActiveBookingsPerUser: 3, cancellationMinHours: 2, bookingHorizonDays: 30 });

    expect(await changeSettings(deps, { ...original, maxActiveBookingsPerUser: 0 })).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: [{ path: "maxActiveBookingsPerUser" }] },
    });

    try {
      expect((await changeSettings(deps, { ...original, maxActiveBookingsPerUser: 1 })).ok).toBe(true);
      const resource = await newResource();
      const actor = user();
      expect(
        (await reserveBooking(deps, actor, { resourceId: resource.id, startsAt: at("2026-10-13T08:00:00-03:00") })).ok,
      ).toBe(true);
      expect(
        await reserveBooking(deps, actor, { resourceId: resource.id, startsAt: at("2026-10-13T09:00:00-03:00") }),
      ).toMatchObject({ code: "BOOKING_LIMIT_REACHED", details: { limit: 1 } });
    } finally {
      await changeSettings(deps, original);
    }
  });
});
