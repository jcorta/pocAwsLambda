// Fechas y horas siempre en la zona del sistema (config.timezone), no en la del navegador (SPEC §5.5).

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "lun 5 oct 2026, 10:00". Se arma con las partes para no depender de la versión de ICU del navegador. */
export function formatDateTime(iso: string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value.replace(/\.$/, "")]),
  );
  return `${parts["weekday"]} ${parts["day"]} ${parts["month"]} ${parts["year"]}, ${formatTime(iso, timezone)}`;
}

/** Fecha local (YYYY-MM-DD) en la zona del sistema, desplazada `days` días desde hoy. */
export function localDate(timezone: string, days = 0, now = new Date()): string {
  const shifted = new Date(now.getTime() + days * 86_400_000);
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** Nombre corto de la zona horaria para mostrar junto a las horas, p. ej. "Buenos Aires". */
export function timezoneLabel(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replace(/_/g, " ");
}
