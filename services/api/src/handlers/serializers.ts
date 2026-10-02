// De los modelos internos a los DTO del contrato (SPEC §4.4).
import type { AvailabilityDto, BookingDto, ResourceDto, SettingsDto } from "@reservas/shared";
import { formatInstant } from "../domain/format.ts";
import type { BookingView } from "../repositories/booking-views.ts";
import type { Resource } from "../repositories/resources.ts";
import type { SettingsRecord } from "../repositories/settings.ts";
import type { Availability } from "../services/resources.ts";

export { formatInstant };

/** `cancelled_by` → "self" si canceló el titular, "admin" si canceló otro (SPEC §4.4). */
export function cancelledByOf(b: Pick<BookingView, "cancelledBy" | "userId">): "self" | "admin" | null {
  return b.cancelledBy === null ? null : b.cancelledBy === b.userId ? "self" : "admin";
}

export function toResourceDto(r: Resource, opts: { isAdmin: boolean; timezone: string }): ResourceDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    attributes: r.attributes,
    slotMinutes: r.slotMinutes,
    openingHours: r.openingHours,
    // `isActive` y las fechas de auditoría solo para admins (SPEC §4.4)
    ...(opts.isAdmin
      ? {
          isActive: r.isActive,
          createdAt: formatInstant(r.createdAt, opts.timezone),
          updatedAt: formatInstant(r.updatedAt, opts.timezone),
        }
      : {}),
  };
}

export function toBookingDto(b: BookingView, opts: { isAdmin: boolean; timezone: string }): BookingDto {
  const tz = opts.timezone;
  return {
    id: b.id,
    resource: { id: b.resourceId, name: b.resourceName },
    startsAt: formatInstant(b.startsAt, tz),
    endsAt: formatInstant(b.endsAt, tz),
    status: b.status,
    createdAt: formatInstant(b.createdAt, tz),
    cancelledAt: b.cancelledAt ? formatInstant(b.cancelledAt, tz) : null,
    cancelledBy: cancelledByOf(b),
    ...(opts.isAdmin ? { user: { id: b.userId, email: b.userEmail } } : {}),
  };
}

export function toAvailabilityDto(a: Availability): AvailabilityDto {
  return {
    resourceId: a.resourceId,
    date: a.date,
    timezone: a.timezone,
    slots: a.slots.map((s) => ({
      startsAt: formatInstant(s.startsAt, a.timezone),
      endsAt: formatInstant(s.endsAt, a.timezone),
      status: s.status,
      mine: s.mine,
    })),
  };
}

export function toSettingsDto(s: SettingsRecord, timezone: string): SettingsDto {
  return {
    maxActiveBookingsPerUser: s.maxActiveBookingsPerUser,
    cancellationMinHours: s.cancellationMinHours,
    bookingHorizonDays: s.bookingHorizonDays,
    updatedAt: formatInstant(s.updatedAt, timezone),
  };
}
