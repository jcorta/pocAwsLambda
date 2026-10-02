// Reglas de negocio (SPEC §2.3). Funciones puras: `now` y `timezone` llegan como parámetros.
import { Temporal } from "temporal-polyfill";
import { findSlot, localDate } from "./slots.ts";
import {
  pass,
  reject,
  SLOT_MINUTES,
  type OpeningHours,
  type RuleFailure,
  type RuleResult,
  type Slot,
} from "./types.ts";

/** Hoy en `timezone`. */
export function today(now: Temporal.Instant, timezone: string): Temporal.PlainDate {
  return localDate(now, timezone);
}

/** CU-03: la fecha consultada debe estar entre hoy y hoy + horizonte (días calendario de `timezone`). */
export function checkDateInHorizon(input: {
  date: Temporal.PlainDate;
  now: Temporal.Instant;
  timezone: string;
  horizonDays: number;
}): RuleResult {
  const { date, now, timezone, horizonDays } = input;
  const first = today(now, timezone);
  const last = first.add({ days: horizonDays });
  if (Temporal.PlainDate.compare(date, first) < 0 || Temporal.PlainDate.compare(date, last) > 0) {
    return reject("DATE_OUT_OF_RANGE", { from: first.toString(), to: last.toString() });
  }
  return pass;
}

/**
 * RN-02 y RN-03: valida que `startsAt` sea un turno futuro, dentro del horizonte y alineado al horario del recurso.
 * Devuelve el turno (con su `endsAt`) si es válido.
 */
export function validateBookingSlot(input: {
  startsAt: Temporal.Instant;
  now: Temporal.Instant;
  timezone: string;
  horizonDays: number;
  openingHours: readonly OpeningHours[];
  slotMinutes: number;
}): { ok: true; slot: Slot } | RuleFailure {
  const { startsAt, now, timezone } = input;

  // RN-03: futuro y dentro del horizonte (por día local, sin importar la hora)
  if (Temporal.Instant.compare(startsAt, now) <= 0) return reject("DATE_OUT_OF_RANGE");
  const horizon = checkDateInHorizon({ ...input, date: localDate(startsAt, timezone) });
  if (!horizon.ok) return horizon;

  // RN-02: tiene que coincidir exactamente con un turno del día
  const slot = findSlot(input);
  if (!slot) return reject("INVALID_SLOT");
  return { ok: true, slot };
}

/** RN-05: límite de reservas activas por usuario. Los admins no tienen límite. */
export function checkActiveBookingsLimit(input: { activeCount: number; limit: number; isAdmin: boolean }): RuleResult {
  if (input.isAdmin || input.activeCount < input.limit) return pass;
  return reject("BOOKING_LIMIT_REACHED", { limit: input.limit });
}

/**
 * RN-06: cancelación. El orden de los chequeos importa:
 * 1. Un `user` no puede ver reservas ajenas: se responde como si no existieran.
 * 2. Ya cancelada, o ya empezó.
 * 3. Ventana de anticipación (solo para `user`). Si falta exactamente `minHours`, se permite.
 */
export function checkCancellation(input: {
  booking: { startsAt: Temporal.Instant; status: "confirmed" | "cancelled"; isOwner: boolean };
  now: Temporal.Instant;
  minHours: number;
  isAdmin: boolean;
}): RuleResult {
  const { booking, now, minHours, isAdmin } = input;
  if (!isAdmin && !booking.isOwner) return reject("BOOKING_NOT_FOUND");
  if (booking.status === "cancelled") return reject("BOOKING_ALREADY_CANCELLED");
  if (Temporal.Instant.compare(booking.startsAt, now) <= 0) return reject("BOOKING_ALREADY_STARTED");
  if (!isAdmin) {
    const deadline = booking.startsAt.subtract({ hours: minHours });
    if (Temporal.Instant.compare(now, deadline) > 0) return reject("CANCELLATION_WINDOW_CLOSED", { minHours });
  }
  return pass;
}

export type SlotStatus = "available" | "booked" | "past";

/**
 * CU-03: estado de un turno. `past` tiene prioridad sobre `booked`.
 * Un turno está ocupado si se solapa con cualquier reserva confirmada (cubre RN-08).
 */
export function slotStatus(input: {
  slot: Slot;
  now: Temporal.Instant;
  bookings: readonly { startsAt: Temporal.Instant; endsAt: Temporal.Instant; isMine: boolean }[];
}): { status: SlotStatus; mine: boolean } {
  const { slot, now, bookings } = input;
  const overlapping = bookings.filter(
    (b) =>
      Temporal.Instant.compare(b.startsAt, slot.endsAt) < 0 && Temporal.Instant.compare(slot.startsAt, b.endsAt) < 0,
  );
  const mine = overlapping.some((b) => b.isMine);
  if (Temporal.Instant.compare(slot.startsAt, now) <= 0) return { status: "past", mine };
  return { status: overlapping.length > 0 ? "booked" : "available", mine };
}

/** Error de validación de un campo, con la forma de `details.fields` (SPEC §4.2). */
export interface FieldError {
  path: string;
  message: string;
}

/** CU-07: valida la duración de turno y el horario semanal de un recurso. Devuelve todos los errores. */
export function validateResourceSchedule(input: {
  slotMinutes: number;
  openingHours: readonly OpeningHours[];
}): FieldError[] {
  const errors: FieldError[] = [];
  const { slotMinutes, openingHours } = input;
  const validSlot = (SLOT_MINUTES as readonly number[]).includes(slotMinutes);
  if (!validSlot) errors.push({ path: "slotMinutes", message: `Debe ser uno de: ${SLOT_MINUTES.join(", ")}` });

  const seen = new Set<number>();
  openingHours.forEach((h, i) => {
    const path = `openingHours[${i}]`;
    if (!Number.isInteger(h.weekday) || h.weekday < 1 || h.weekday > 7) {
      errors.push({ path: `${path}.weekday`, message: "Debe ser un día ISO entre 1 (lunes) y 7 (domingo)" });
    } else if (seen.has(h.weekday)) {
      errors.push({ path: `${path}.weekday`, message: "Día repetido: solo se admite una franja por día" });
    }
    seen.add(h.weekday);

    const opens = parseTime(h.opensAt);
    const closes = parseTime(h.closesAt);
    if (!opens) errors.push({ path: `${path}.opensAt`, message: "Hora inválida (formato HH:mm)" });
    if (!closes) errors.push({ path: `${path}.closesAt`, message: "Hora inválida (formato HH:mm)" });
    if (!opens || !closes) return;

    const minutes = opens.until(closes).total({ unit: "minutes" });
    if (minutes <= 0) {
      errors.push({ path: `${path}.closesAt`, message: "El cierre debe ser posterior a la apertura" });
    } else if (validSlot && minutes % slotMinutes !== 0) {
      errors.push({ path, message: `La duración de la franja debe ser múltiplo de ${slotMinutes} minutos` });
    }
  });
  return errors;
}

function parseTime(value: string): Temporal.PlainTime | null {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  try {
    return Temporal.PlainTime.from(value, { overflow: "reject" });
  } catch {
    return null;
  }
}
