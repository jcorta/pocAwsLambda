import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
  checkActiveBookingsLimit,
  checkCancellation,
  checkDateInHorizon,
  slotStatus,
  today,
  validateBookingSlot,
  validateResourceSchedule,
} from "./rules.ts";
import type { OpeningHours } from "./types.ts";

const BA = "America/Argentina/Buenos_Aires";
const NY = "America/New_York";
const at = (iso: string) => Temporal.Instant.from(iso);
const date = (iso: string) => Temporal.PlainDate.from(iso);
const allWeek = (opensAt: string, closesAt: string): OpeningHours[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

// Viernes 2 de octubre de 2026, 12:00 en Buenos Aires
const NOW = at("2026-10-02T12:00:00-03:00");

describe("today", () => {
  it("usa la zona del sistema: a las 23:30 de Buenos Aires ya es el día siguiente en UTC, pero no localmente", () => {
    expect(today(at("2026-10-02T23:30:00-03:00"), BA).toString()).toBe("2026-10-02");
  });
});

describe("checkDateInHorizon (CU-03, RN-03)", () => {
  const check = (d: string, horizonDays = 30) =>
    checkDateInHorizon({ date: date(d), now: NOW, timezone: BA, horizonDays });

  it("rechaza ayer", () => expect(check("2026-10-01")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" }));
  it("acepta hoy", () => expect(check("2026-10-02")).toEqual({ ok: true }));
  it("acepta hoy + 30", () => expect(check("2026-11-01")).toEqual({ ok: true }));
  it("rechaza hoy + 31 e informa el rango", () =>
    expect(check("2026-11-02")).toEqual({
      ok: false,
      code: "DATE_OUT_OF_RANGE",
      details: { from: "2026-10-02", to: "2026-11-01" },
    }));
  it("respeta un horizonte configurado distinto", () => expect(check("2026-10-09", 7)).toEqual({ ok: true }));
});

describe("validateBookingSlot (RN-02, RN-03)", () => {
  const validate = (startsAt: string, overrides: Partial<Parameters<typeof validateBookingSlot>[0]> = {}) =>
    validateBookingSlot({
      startsAt: at(startsAt),
      now: NOW,
      timezone: BA,
      horizonDays: 30,
      openingHours: allWeek("08:00", "20:00"),
      slotMinutes: 60,
      ...overrides,
    });

  it("acepta un turno futuro válido y devuelve su fin", () => {
    const r = validate("2026-10-05T10:00:00-03:00");
    expect(r.ok && r.slot.endsAt.toString()).toBe("2026-10-05T14:00:00Z");
  });

  it("rechaza un turno en el pasado", () =>
    expect(validate("2026-10-02T09:00:00-03:00")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" }));

  it("rechaza un turno que empieza justo ahora", () =>
    expect(validate("2026-10-02T12:00:00-03:00")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" }));

  it("acepta un turno de hoy que todavía no empezó", () => expect(validate("2026-10-02T13:00:00-03:00").ok).toBe(true));

  it("rechaza un inicio desalineado", () =>
    expect(validate("2026-10-05T10:30:00-03:00")).toMatchObject({ ok: false, code: "INVALID_SLOT" }));

  it("rechaza un inicio fuera de horario", () =>
    expect(validate("2026-10-05T20:00:00-03:00")).toMatchObject({ ok: false, code: "INVALID_SLOT" }));

  it("rechaza un día sin horario de apertura", () =>
    expect(
      validate("2026-10-04T10:00:00-03:00", { openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "20:00" }] }),
    ).toMatchObject({ ok: false, code: "INVALID_SLOT" }));

  it("acepta el último turno de hoy + 30 (el horizonte es por día, sin importar la hora)", () =>
    expect(validate("2026-11-01T19:00:00-03:00").ok).toBe(true));

  it("rechaza el primer turno de hoy + 31", () =>
    expect(validate("2026-11-02T08:00:00-03:00")).toMatchObject({ ok: false, code: "DATE_OUT_OF_RANGE" }));

  it("en Nueva York acepta la segunda ocurrencia de la hora repetida", () =>
    expect(
      validate("2026-11-01T01:00:00-05:00", {
        now: at("2026-10-31T12:00:00-04:00"),
        timezone: NY,
        openingHours: allWeek("00:00", "04:00"),
      }).ok,
    ).toBe(true));

  it("en Nueva York rechaza la hora que no existe el día que se adelanta el reloj", () =>
    // 02:00 local no existe; el instante 07:00Z es 03:00 EDT, que sí es turno. 06:30Z (01:30 EST) no lo es.
    expect(
      validate("2026-03-08T06:30:00Z", {
        now: at("2026-03-01T12:00:00-05:00"),
        timezone: NY,
        openingHours: allWeek("00:00", "04:00"),
      }),
    ).toMatchObject({ ok: false, code: "INVALID_SLOT" }));
});

describe("checkActiveBookingsLimit (RN-05)", () => {
  it("permite reservar por debajo del límite", () =>
    expect(checkActiveBookingsLimit({ activeCount: 2, limit: 3, isAdmin: false })).toEqual({ ok: true }));
  it("rechaza al alcanzar el límite e informa el valor", () =>
    expect(checkActiveBookingsLimit({ activeCount: 3, limit: 3, isAdmin: false })).toEqual({
      ok: false,
      code: "BOOKING_LIMIT_REACHED",
      details: { limit: 3 },
    }));
  it("no aplica el límite a los admins", () =>
    expect(checkActiveBookingsLimit({ activeCount: 10, limit: 3, isAdmin: true })).toEqual({ ok: true }));
});

describe("checkCancellation (RN-06)", () => {
  const STARTS = at("2026-10-05T10:00:00-03:00");
  const cancel = (
    now: Temporal.Instant,
    opts: { isAdmin?: boolean; isOwner?: boolean; status?: "confirmed" | "cancelled"; minHours?: number } = {},
  ) =>
    checkCancellation({
      booking: { startsAt: STARTS, status: opts.status ?? "confirmed", isOwner: opts.isOwner ?? true },
      now,
      minHours: opts.minHours ?? 2,
      isAdmin: opts.isAdmin ?? false,
    });

  it("permite cancelar con más anticipación que la mínima", () =>
    expect(cancel(at("2026-10-05T07:00:00-03:00"))).toEqual({ ok: true }));

  it("permite cancelar si falta exactamente la anticipación mínima (borde)", () =>
    expect(cancel(at("2026-10-05T08:00:00-03:00"))).toEqual({ ok: true }));

  it("rechaza si falta un minuto menos que la anticipación mínima", () =>
    expect(cancel(at("2026-10-05T08:01:00-03:00"))).toEqual({
      ok: false,
      code: "CANCELLATION_WINDOW_CLOSED",
      details: { minHours: 2 },
    }));

  it("el admin cancela sin importar la anticipación", () =>
    expect(cancel(at("2026-10-05T09:50:00-03:00"), { isAdmin: true, isOwner: false })).toEqual({ ok: true }));

  it("un user no ve reservas ajenas: BOOKING_NOT_FOUND", () =>
    expect(cancel(at("2026-10-05T07:00:00-03:00"), { isOwner: false })).toMatchObject({ code: "BOOKING_NOT_FOUND" }));

  it("una reserva ajena cancelada también responde BOOKING_NOT_FOUND (no revela su estado)", () =>
    expect(cancel(at("2026-10-05T07:00:00-03:00"), { isOwner: false, status: "cancelled" })).toMatchObject({
      code: "BOOKING_NOT_FOUND",
    }));

  it("rechaza una reserva ya cancelada", () =>
    expect(cancel(at("2026-10-05T07:00:00-03:00"), { status: "cancelled" })).toMatchObject({
      code: "BOOKING_ALREADY_CANCELLED",
    }));

  it("rechaza una reserva que empieza justo ahora, incluso al admin", () =>
    expect(cancel(STARTS, { isAdmin: true })).toMatchObject({ code: "BOOKING_ALREADY_STARTED" }));

  it("con anticipación mínima 0 se puede cancelar hasta el último momento", () =>
    expect(cancel(at("2026-10-05T09:59:00-03:00"), { minHours: 0 })).toEqual({ ok: true }));
});

describe("slotStatus (CU-03, RN-08)", () => {
  const slot = { startsAt: at("2026-10-05T10:30:00-03:00"), endsAt: at("2026-10-05T11:00:00-03:00") };
  const booking = (s: string, e: string, isMine = false) => ({ startsAt: at(s), endsAt: at(e), isMine });

  it("disponible si no hay reservas", () =>
    expect(slotStatus({ slot, now: NOW, bookings: [] })).toEqual({ status: "available", mine: false }));

  it("ocupado si una reserva lo solapa parcialmente (reserva vieja de 60 min, turno nuevo de 30)", () =>
    expect(
      slotStatus({ slot, now: NOW, bookings: [booking("2026-10-05T10:00:00-03:00", "2026-10-05T11:00:00-03:00")] }),
    ).toEqual({ status: "booked", mine: false }));

  it("no ocupado por una reserva contigua", () =>
    expect(
      slotStatus({ slot, now: NOW, bookings: [booking("2026-10-05T11:00:00-03:00", "2026-10-05T12:00:00-03:00")] }),
    ).toEqual({ status: "available", mine: false }));

  it("marca mine si la reserva es del usuario", () =>
    expect(
      slotStatus({
        slot,
        now: NOW,
        bookings: [booking("2026-10-05T10:30:00-03:00", "2026-10-05T11:00:00-03:00", true)],
      }),
    ).toEqual({ status: "booked", mine: true }));

  it("past tiene prioridad sobre booked, pero sigue informando mine", () =>
    expect(
      slotStatus({
        slot,
        now: at("2026-10-05T10:30:00-03:00"),
        bookings: [booking("2026-10-05T10:30:00-03:00", "2026-10-05T11:00:00-03:00", true)],
      }),
    ).toEqual({ status: "past", mine: true }));
});

describe("validateResourceSchedule (CU-07)", () => {
  it("acepta un horario válido", () =>
    expect(validateResourceSchedule({ slotMinutes: 60, openingHours: allWeek("08:00", "20:00") })).toEqual([]));

  it("acepta un horario vacío (el recurso no tiene turnos)", () =>
    expect(validateResourceSchedule({ slotMinutes: 30, openingHours: [] })).toEqual([]));

  it("rechaza un slotMinutes no permitido", () =>
    expect(validateResourceSchedule({ slotMinutes: 50, openingHours: [] })).toEqual([
      { path: "slotMinutes", message: "Debe ser uno de: 15, 30, 45, 60, 90, 120" },
    ]));

  it("rechaza días repetidos y fuera de rango", () => {
    const errors = validateResourceSchedule({
      slotMinutes: 60,
      openingHours: [
        { weekday: 1, opensAt: "08:00", closesAt: "10:00" },
        { weekday: 1, opensAt: "08:00", closesAt: "10:00" },
        { weekday: 8, opensAt: "08:00", closesAt: "10:00" },
      ],
    });
    expect(errors.map((e) => e.path)).toEqual(["openingHours[1].weekday", "openingHours[2].weekday"]);
  });

  it("rechaza un cierre igual o anterior a la apertura", () =>
    expect(
      validateResourceSchedule({
        slotMinutes: 60,
        openingHours: [{ weekday: 1, opensAt: "10:00", closesAt: "10:00" }],
      }),
    ).toEqual([{ path: "openingHours[0].closesAt", message: "El cierre debe ser posterior a la apertura" }]));

  it("rechaza una franja que no es múltiplo de slotMinutes", () =>
    expect(
      validateResourceSchedule({
        slotMinutes: 90,
        openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "10:00" }],
      }),
    ).toEqual([{ path: "openingHours[0]", message: "La duración de la franja debe ser múltiplo de 90 minutos" }]));

  it("rechaza horas con formato inválido", () => {
    const errors = validateResourceSchedule({
      slotMinutes: 60,
      openingHours: [{ weekday: 1, opensAt: "8:00", closesAt: "25:00" }],
    });
    expect(errors.map((e) => e.path)).toEqual(["openingHours[0].opensAt", "openingHours[0].closesAt"]);
  });
});
