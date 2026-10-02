import { BookingSchema, ResourceSchema } from "@reservas/shared";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { BookingView } from "../repositories/booking-views.ts";
import type { Resource } from "../repositories/resources.ts";
import { formatInstant, toBookingDto, toResourceDto } from "./serializers.ts";

const BA = "America/Argentina/Buenos_Aires";

describe("formatInstant (SPEC §4.1)", () => {
  it("formatea con el offset de la zona del sistema", () => {
    expect(formatInstant(new Date("2026-10-05T11:00:00Z"), BA)).toBe("2026-10-05T08:00:00-03:00");
    expect(formatInstant(Temporal.Instant.from("2026-10-05T12:00:00Z"), "America/New_York")).toBe(
      "2026-10-05T08:00:00-04:00",
    );
  });
});

const resource: Resource = {
  id: "0b6f0c2e-6a39-4bd2-9b9e-3a52c2c3a1f4",
  name: "Sala Azul",
  description: null,
  attributes: { capacidad: 8 },
  slotMinutes: 60,
  isActive: true,
  openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "20:00" }],
  createdAt: new Date("2026-10-01T12:00:00Z"),
  updatedAt: new Date("2026-10-01T12:00:00Z"),
};

describe("toResourceDto", () => {
  it("oculta isActive y las fechas a los users", () => {
    const dto = toResourceDto(resource, { isAdmin: false, timezone: BA });
    expect(dto).not.toHaveProperty("isActive");
    expect(dto).not.toHaveProperty("createdAt");
    expect(ResourceSchema.parse(dto)).toEqual(dto);
  });

  it("los muestra a los admins", () =>
    expect(toResourceDto(resource, { isAdmin: true, timezone: BA })).toMatchObject({
      isActive: true,
      createdAt: "2026-10-01T09:00:00-03:00",
    }));
});

describe("toBookingDto", () => {
  const view: BookingView = {
    id: "5f2a1c9e-1d2b-4c3a-8e7f-6a5b4c3d2e1f",
    resourceId: resource.id,
    resourceName: "Sala Azul",
    userId: "user-1",
    userEmail: "user@example.com",
    startsAt: new Date("2026-10-05T13:00:00Z"),
    endsAt: new Date("2026-10-05T14:00:00Z"),
    status: "confirmed",
    createdAt: new Date("2026-10-02T15:00:00Z"),
    cancelledAt: null,
    cancelledBy: null,
  };

  it("cumple el contrato y no expone al titular a un user", () => {
    const dto = toBookingDto(view, { isAdmin: false, timezone: BA });
    expect(BookingSchema.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({ startsAt: "2026-10-05T10:00:00-03:00", cancelledBy: null });
    expect(dto).not.toHaveProperty("user");
  });

  it("cancelledBy es self si canceló el titular y admin si canceló otro", () => {
    const cancelled = { ...view, status: "cancelled" as const, cancelledAt: new Date("2026-10-03T12:00:00Z") };
    expect(toBookingDto({ ...cancelled, cancelledBy: "user-1" }, { isAdmin: false, timezone: BA }).cancelledBy).toBe(
      "self",
    );
    expect(toBookingDto({ ...cancelled, cancelledBy: "admin-1" }, { isAdmin: false, timezone: BA }).cancelledBy).toBe(
      "admin",
    );
  });

  it("incluye al titular en las vistas de admin", () =>
    expect(toBookingDto(view, { isAdmin: true, timezone: BA }).user).toEqual({
      id: "user-1",
      email: "user@example.com",
    }));
});
