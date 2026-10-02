// Tipos del dominio. No dependen de la base de datos ni de AWS.
import type { ErrorCode } from "@reservas/shared";
import type { Temporal } from "temporal-polyfill";

export const SLOT_MINUTES = [15, 30, 45, 60, 90, 120] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];

/** Día de semana ISO: 1 = lunes … 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Franja de apertura de un día, en hora local de APP_TIMEZONE ("HH:mm" o "HH:mm:ss"). */
export interface OpeningHours {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface Slot {
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
}

/** Reglas configurables (tabla `settings`, SPEC §3.2). */
export interface BookingSettings {
  maxActiveBookingsPerUser: number;
  cancellationMinHours: number;
  bookingHorizonDays: number;
}

/** Resultado de una regla: o pasa, o falla con un código del catálogo (SPEC §4.3). */
export interface RuleFailure {
  ok: false;
  code: ErrorCode;
  details?: Record<string, unknown>;
}
export type RuleResult = { ok: true } | RuleFailure;

export const pass: RuleResult = { ok: true };
export const reject = (code: ErrorCode, details?: Record<string, unknown>): RuleFailure =>
  details ? { ok: false, code, details } : { ok: false, code };
