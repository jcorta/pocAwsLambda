// Generación de turnos (SPEC §2.2 y RN-02). Función pura: recibe la fecha, el horario y la zona horaria.
import { Temporal } from "temporal-polyfill";
import type { OpeningHours, Slot } from "./types.ts";

/**
 * Turnos de un recurso en una fecha local de `timezone`.
 *
 * Los turnos se generan en **tiempo absoluto**: desde la apertura, cada `slotMinutes` minutos reales,
 * mientras el turno termine antes o en el cierre. En los días de cambio de hora esto significa:
 * - Si se adelanta la hora (día de 23 h), la hora que no existe no tiene turno.
 * - Si se atrasa la hora (día de 25 h), la hora repetida tiene dos turnos distintos, sin solaparse.
 * Así todo turno dura exactamente `slotMinutes` y ninguno se pisa con otro.
 */
export function generateSlots(input: {
  date: Temporal.PlainDate;
  openingHours: readonly OpeningHours[];
  slotMinutes: number;
  timezone: string;
}): Slot[] {
  const { date, openingHours, slotMinutes, timezone } = input;
  const hours = openingHours.find((h) => h.weekday === date.dayOfWeek);
  if (!hours) return [];

  // 'compatible': una hora inexistente se corre hacia adelante y una repetida toma la primera ocurrencia
  const open = date.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(hours.opensAt) });
  const close = date.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(hours.closesAt) });
  const step = Temporal.Duration.from({ minutes: slotMinutes });

  const slots: Slot[] = [];
  for (let start = open.toInstant(); ;) {
    const end = start.add(step);
    if (Temporal.Instant.compare(end, close.toInstant()) > 0) break;
    slots.push({ startsAt: start, endsAt: end });
    start = end;
  }
  return slots;
}

/** Fecha local (en `timezone`) de un instante. */
export function localDate(instant: Temporal.Instant, timezone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timezone).toPlainDate();
}

/** Busca el turno que empieza exactamente en `startsAt`, o null si no coincide con ninguno (RN-02). */
export function findSlot(input: {
  startsAt: Temporal.Instant;
  openingHours: readonly OpeningHours[];
  slotMinutes: number;
  timezone: string;
}): Slot | null {
  const { startsAt, timezone } = input;
  const slots = generateSlots({ ...input, date: localDate(startsAt, timezone) });
  return slots.find((s) => s.startsAt.equals(startsAt)) ?? null;
}
