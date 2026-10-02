import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { findSlot, generateSlots } from "./slots.ts";
import type { OpeningHours } from "./types.ts";

const BA = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
const NY = "America/New_York"; // con horario de verano: 2026-03-08 se adelanta, 2026-11-01 se atrasa

const allWeek = (opensAt: string, closesAt: string): OpeningHours[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

/** Inicios de los turnos como hora local con offset, para que los tests se lean fácil. */
const starts = (slots: ReturnType<typeof generateSlots>, tz: string) =>
  slots.map((s) => s.startsAt.toZonedDateTimeISO(tz).toString({ timeZoneName: "never" }));

describe("generateSlots", () => {
  it("genera turnos de 60 min dentro de la franja (08:00 a 12:00 → 4 turnos)", () => {
    const slots = generateSlots({
      date: Temporal.PlainDate.from("2026-10-05"), // lunes
      openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }],
      slotMinutes: 60,
      timezone: BA,
    });
    expect(starts(slots, BA)).toEqual([
      "2026-10-05T08:00:00-03:00",
      "2026-10-05T09:00:00-03:00",
      "2026-10-05T10:00:00-03:00",
      "2026-10-05T11:00:00-03:00",
    ]);
    expect(slots[0]!.endsAt.toString()).toBe("2026-10-05T12:00:00Z");
  });

  it.each([
    [15, 8],
    [60, 2],
    [120, 1],
  ])("con slotMinutes %i genera %i turnos en una franja de 2 h", (slotMinutes, expected) => {
    const slots = generateSlots({
      date: Temporal.PlainDate.from("2026-10-05"),
      openingHours: [{ weekday: 1, opensAt: "10:00", closesAt: "12:00" }],
      slotMinutes,
      timezone: BA,
    });
    expect(slots).toHaveLength(expected);
    for (const s of slots) expect(s.startsAt.until(s.endsAt).total({ unit: "minutes" })).toBe(slotMinutes);
  });

  it("devuelve una lista vacía en un día sin horario de apertura", () => {
    const slots = generateSlots({
      date: Temporal.PlainDate.from("2026-10-04"), // domingo
      openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }],
      slotMinutes: 60,
      timezone: BA,
    });
    expect(slots).toEqual([]);
  });

  it("acepta horas con segundos, como las devuelve Postgres (HH:mm:ss)", () => {
    const slots = generateSlots({
      date: Temporal.PlainDate.from("2026-10-05"),
      openingHours: [{ weekday: 1, opensAt: "08:00:00", closesAt: "09:00:00" }],
      slotMinutes: 30,
      timezone: BA,
    });
    expect(slots).toHaveLength(2);
  });

  it("interpreta el horario en la zona del sistema, no en UTC", () => {
    const [ba] = generateSlots({
      date: Temporal.PlainDate.from("2026-10-05"),
      openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "09:00" }],
      slotMinutes: 60,
      timezone: BA,
    });
    const [ny] = generateSlots({
      date: Temporal.PlainDate.from("2026-10-05"),
      openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "09:00" }],
      slotMinutes: 60,
      timezone: NY,
    });
    expect(ba!.startsAt.toString()).toBe("2026-10-05T11:00:00Z");
    expect(ny!.startsAt.toString()).toBe("2026-10-05T12:00:00Z"); // EDT, UTC-4
  });

  describe("días de cambio de hora (America/New_York)", () => {
    it("cuando se adelanta la hora (día de 23 h), la hora inexistente no tiene turno", () => {
      const slots = generateSlots({
        date: Temporal.PlainDate.from("2026-03-08"),
        openingHours: allWeek("00:00", "04:00"),
        slotMinutes: 60,
        timezone: NY,
      });
      expect(starts(slots, NY)).toEqual([
        "2026-03-08T00:00:00-05:00",
        "2026-03-08T01:00:00-05:00",
        "2026-03-08T03:00:00-04:00", // 02:00 no existe ese día
      ]);
    });

    it("cuando se atrasa la hora (día de 25 h), la hora repetida tiene dos turnos sin solaparse", () => {
      const slots = generateSlots({
        date: Temporal.PlainDate.from("2026-11-01"),
        openingHours: allWeek("00:00", "04:00"),
        slotMinutes: 60,
        timezone: NY,
      });
      expect(starts(slots, NY)).toEqual([
        "2026-11-01T00:00:00-04:00",
        "2026-11-01T01:00:00-04:00",
        "2026-11-01T01:00:00-05:00", // la misma hora local, una hora real después
        "2026-11-01T02:00:00-05:00",
        "2026-11-01T03:00:00-05:00",
      ]);
      for (let i = 1; i < slots.length; i++) expect(slots[i]!.startsAt.equals(slots[i - 1]!.endsAt)).toBe(true);
    });

    it("una apertura en una hora inexistente se corre hacia adelante", () => {
      const slots = generateSlots({
        date: Temporal.PlainDate.from("2026-03-08"),
        openingHours: allWeek("02:30", "05:30"),
        slotMinutes: 60,
        timezone: NY,
      });
      expect(starts(slots, NY)[0]).toBe("2026-03-08T03:30:00-04:00");
    });

    it("en un día normal de Nueva York genera la cantidad esperada", () => {
      const slots = generateSlots({
        date: Temporal.PlainDate.from("2026-10-05"),
        openingHours: allWeek("00:00", "04:00"),
        slotMinutes: 60,
        timezone: NY,
      });
      expect(slots).toHaveLength(4);
    });
  });
});

describe("findSlot", () => {
  const openingHours = allWeek("08:00", "12:00");

  it("encuentra el turno que empieza exactamente en el instante dado, con cualquier offset", () => {
    const slot = findSlot({
      startsAt: Temporal.Instant.from("2026-10-05T13:00:00Z"), // 10:00 en Buenos Aires
      openingHours,
      slotMinutes: 60,
      timezone: BA,
    });
    expect(slot?.endsAt.toString()).toBe("2026-10-05T14:00:00Z");
  });

  it("devuelve null para un inicio desalineado", () => {
    expect(
      findSlot({
        startsAt: Temporal.Instant.from("2026-10-05T08:30:00-03:00"),
        openingHours,
        slotMinutes: 60,
        timezone: BA,
      }),
    ).toBeNull();
  });

  it("encuentra la segunda ocurrencia de la hora repetida en Nueva York", () => {
    const slot = findSlot({
      startsAt: Temporal.Instant.from("2026-11-01T01:00:00-05:00"),
      openingHours: allWeek("00:00", "04:00"),
      slotMinutes: 60,
      timezone: NY,
    });
    expect(slot).not.toBeNull();
  });
});
