import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, localDate, timezoneLabel } from "./format.ts";
import { openingHoursFromRows, rowErrors, rowsFromOpeningHours } from "./schedule.ts";

const BA = "America/Argentina/Buenos_Aires";

describe("format (SPEC §5.5: horas en la zona del sistema)", () => {
  it("muestra la hora de Buenos Aires aunque el instante venga en UTC", () =>
    expect(formatTime("2026-10-05T13:00:00Z", BA)).toBe("10:00"));

  it("arma la fecha corta sin depender de la versión de ICU", () =>
    expect(formatDateTime("2026-10-05T13:00:00Z", BA)).toBe("lun 5 oct 2026, 10:00"));

  it("calcula la fecha local de hoy y de días siguientes", () => {
    const now = new Date("2026-10-03T02:30:00Z"); // 23:30 del 2 de octubre en Buenos Aires
    expect(localDate(BA, 0, now)).toBe("2026-10-02");
    expect(localDate(BA, 1, now)).toBe("2026-10-03");
  });

  it("muestra un nombre corto de la zona", () => expect(timezoneLabel(BA)).toBe("Buenos Aires"));
});

describe("grilla semanal ↔ openingHours (CU-07)", () => {
  const hours = [
    { weekday: 1, opensAt: "08:00", closesAt: "12:00" },
    { weekday: 3, opensAt: "09:00", closesAt: "17:00" },
  ];

  it("arma una fila por día, con los cerrados desmarcados", () => {
    const rows = rowsFromOpeningHours(hours);
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.open).map((r) => r.weekday)).toEqual([1, 3]);
  });

  it("solo envía los días abiertos (ida y vuelta sin pérdida)", () =>
    expect(openingHoursFromRows(rowsFromOpeningHours(hours))).toEqual(hours));

  it("traduce los errores de la API (índice del array enviado) al día de la grilla", () => {
    const rows = rowsFromOpeningHours(hours);
    // openingHours[1] es el miércoles, porque el lunes es el índice 0
    expect(rowErrors(rows, { "openingHours[1]": "Debe ser múltiplo de 60", name: "x" })).toEqual({
      3: "Debe ser múltiplo de 60",
    });
  });

  it("junta varios errores del mismo día", () =>
    expect(
      rowErrors(rowsFromOpeningHours(hours), {
        "openingHours[0].opensAt": "Hora inválida.",
        "openingHours[0]": "Otro.",
      }),
    ).toEqual({ 1: "Hora inválida. Otro." }));
});
