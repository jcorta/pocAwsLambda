// Plantillas de email en español (CU-10): recurso, fecha y hora en APP_TIMEZONE, y la acción realizada.
import type { BookingEvent } from "./event.ts";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "lunes 5 de octubre de 2026, de 10:00 a 11:00" en la zona del sistema. */
export function formatSlot(startsAt: string, endsAt: string, timezone: string): string {
  // Se arma la frase con las partes, en lugar de usar el formato completo de Intl: así no depende de
  // la versión de ICU del runtime (unas ponen coma después del día de la semana y otras no)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .formatToParts(new Date(startsAt))
      .map((p) => [p.type, p.value]),
  );
  const day = `${parts["weekday"]} ${parts["day"]} de ${parts["month"]} de ${parts["year"]}`;
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, de ${time.format(new Date(startsAt))} a ${time.format(new Date(endsAt))}`;
}

export function renderEmail(event: BookingEvent, timezone: string): Email {
  const { resourceName, startsAt, endsAt } = event.booking;
  const when = formatSlot(startsAt, endsAt, timezone);
  const confirmed = event.type === "booking_confirmed";

  const subject = confirmed ? `Reserva confirmada: ${resourceName}` : `Reserva cancelada: ${resourceName}`;
  const action = confirmed
    ? "Tu reserva quedó confirmada."
    : event.cancelledBy === "admin"
      ? "Un administrador canceló tu reserva."
      : "Cancelaste tu reserva.";
  const lines = [action, "", `Recurso: ${resourceName}`, `Turno: ${when}`, `Zona horaria: ${timezone}`];

  return {
    subject,
    text: lines.join("\n"),
    html: `<p>${escapeHtml(action)}</p><ul><li><strong>Recurso:</strong> ${escapeHtml(resourceName)}</li><li><strong>Turno:</strong> ${escapeHtml(when)}</li><li><strong>Zona horaria:</strong> ${escapeHtml(timezone)}</li></ul>`,
  };
}
