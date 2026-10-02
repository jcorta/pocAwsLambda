// Formato de instantes del contrato (SPEC §4.1). Lo usan los serializadores HTTP y los eventos de SQS.
import { Temporal } from "temporal-polyfill";

/** ISO 8601 con el offset de `timezone`, p. ej. "2026-10-05T08:00:00-03:00". */
export function formatInstant(value: Date | Temporal.Instant, timezone: string): string {
  const instant = value instanceof Date ? Temporal.Instant.fromEpochMilliseconds(value.getTime()) : value;
  return instant.toZonedDateTimeISO(timezone).toString({ timeZoneName: "never", smallestUnit: "second" });
}
