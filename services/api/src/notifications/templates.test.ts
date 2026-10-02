import { describe, expect, it } from "vitest";
import type { BookingEvent } from "./event.ts";
import { formatSlot, renderEmail } from "./templates.ts";

const BA = "America/Argentina/Buenos_Aires";

const event = (overrides: Partial<BookingEvent> = {}): BookingEvent => ({
  eventId: "8c2a3f4e-1b5d-4c6e-9f7a-0b1c2d3e4f5a",
  type: "booking_confirmed",
  occurredAt: "2026-10-02T12:00:00-03:00",
  booking: {
    id: "5f2a1c9e-1d2b-4c3a-8e7f-6a5b4c3d2e1f",
    resourceName: "Sala <Azul> & Co",
    startsAt: "2026-10-05T10:00:00-03:00",
    endsAt: "2026-10-05T11:00:00-03:00",
    userEmail: "user@example.com",
  },
  cancelledBy: null,
  ...overrides,
});

describe("formatSlot", () => {
  it("formatea el turno en español y en la zona del sistema", () =>
    expect(formatSlot("2026-10-05T13:00:00Z", "2026-10-05T14:00:00Z", BA)).toBe(
      "lunes 5 de octubre de 2026, de 10:00 a 11:00",
    ));
});

describe("renderEmail (CU-10)", () => {
  it("confirmación: asunto, recurso, turno y zona horaria", () => {
    const email = renderEmail(event(), BA);
    expect(email.subject).toBe("Reserva confirmada: Sala <Azul> & Co");
    expect(email.text).toContain("Tu reserva quedó confirmada.");
    expect(email.text).toContain("Turno: lunes 5 de octubre de 2026, de 10:00 a 11:00");
    expect(email.text).toContain(`Zona horaria: ${BA}`);
  });

  it("escapa el HTML del nombre del recurso", () =>
    expect(renderEmail(event(), BA).html).toContain("Sala &lt;Azul&gt; &amp; Co"));

  it("cancelación propia y cancelación por un admin tienen textos distintos", () => {
    expect(renderEmail(event({ type: "booking_cancelled", cancelledBy: "self" }), BA)).toMatchObject({
      subject: "Reserva cancelada: Sala <Azul> & Co",
      text: expect.stringContaining("Cancelaste tu reserva."),
    });
    expect(renderEmail(event({ type: "booking_cancelled", cancelledBy: "admin" }), BA).text).toContain(
      "Un administrador canceló tu reserva.",
    );
  });
});
