// Contrato de la API (SPEC §4): esquemas Zod compartidos entre la API y el frontend.
// Se validan los requests en la API y, en los tests E2E, también las respuestas (test de contrato).
import { z } from "zod";
import { ERROR_CODES } from "./errors.ts";

export const SLOT_MINUTES = [15, 30, 45, 60, 90, 120] as const;

/** Instante ISO 8601 con offset obligatorio, p. ej. "2026-10-05T08:00:00-03:00" (SPEC §4.1). */
export const InstantString = z.iso.datetime({ offset: true });
/** Fecha sin hora, interpretada en APP_TIMEZONE. */
export const DateString = z.iso.date();
/** Hora local "HH:mm". */
export const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (formato HH:mm)");

export const OpeningHoursSchema = z.object({
  weekday: z.int().min(1).max(7),
  opensAt: TimeString,
  closesAt: TimeString,
});

const resourceFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  slotMinutes: z.int(),
  openingHours: z.array(OpeningHoursSchema).max(7),
};

/** Body de POST /v1/admin/resources. */
export const CreateResourceSchema = z.object(resourceFields);
/** Body de PUT /v1/admin/resources/{id}: reemplazo completo, incluido `isActive`. */
export const ReplaceResourceSchema = z.object({ ...resourceFields, isActive: z.boolean() });

export const ResourceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  slotMinutes: z.int(),
  openingHours: z.array(OpeningHoursSchema),
  // Solo en las respuestas a un admin
  isActive: z.boolean().optional(),
  createdAt: InstantString.optional(),
  updatedAt: InstantString.optional(),
});

/** Body de POST /v1/bookings. `endsAt` lo calcula el servidor. */
export const CreateBookingSchema = z.object({
  resourceId: z.uuid(),
  startsAt: InstantString,
});

export const BookingSchema = z.object({
  id: z.uuid(),
  resource: z.object({ id: z.uuid(), name: z.string() }),
  startsAt: InstantString,
  endsAt: InstantString,
  status: z.enum(["confirmed", "cancelled"]),
  createdAt: InstantString,
  cancelledAt: InstantString.nullable(),
  cancelledBy: z.enum(["self", "admin"]).nullable(),
  // Solo en las vistas de admin
  user: z.object({ id: z.string(), email: z.string() }).optional(),
});

export const AvailabilitySchema = z.object({
  resourceId: z.uuid(),
  date: DateString,
  timezone: z.string(),
  slots: z.array(
    z.object({
      startsAt: InstantString,
      endsAt: InstantString,
      status: z.enum(["available", "booked", "past"]),
      mine: z.boolean(),
    }),
  ),
});

export const SettingsInputSchema = z.object({
  maxActiveBookingsPerUser: z.int().min(1).max(32767),
  cancellationMinHours: z.int().min(0).max(32767),
  bookingHorizonDays: z.int().min(1).max(32767),
});
export const SettingsSchema = SettingsInputSchema.extend({ updatedAt: InstantString });

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  roles: z.array(z.enum(["user", "admin"])),
});

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Query de los listados paginados (SPEC §4.1). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const AvailabilityQuerySchema = z.object({ date: DateString });

export const MyBookingsQuerySchema = PaginationQuerySchema.extend({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
});

export const AdminBookingsQuerySchema = PaginationQuerySchema.extend({
  resourceId: z.uuid().optional(),
  from: DateString.optional(),
  to: DateString.optional(),
  status: z.enum(["confirmed", "cancelled"]).optional(),
  userEmail: z.string().min(1).optional(),
});

export const ResourcesQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});

export type OpeningHoursDto = z.infer<typeof OpeningHoursSchema>;
export type CreateResourceInput = z.infer<typeof CreateResourceSchema>;
export type ReplaceResourceInput = z.infer<typeof ReplaceResourceSchema>;
export type ResourceDto = z.infer<typeof ResourceSchema>;
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
export type BookingDto = z.infer<typeof BookingSchema>;
export type AvailabilityDto = z.infer<typeof AvailabilitySchema>;
export type SettingsDto = z.infer<typeof SettingsSchema>;
export type MeDto = z.infer<typeof MeSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
