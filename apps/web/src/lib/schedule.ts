// Conversión entre la grilla semanal del formulario de recursos y `openingHours` del contrato (SPEC §4.5).
import type { OpeningHoursDto } from "@reservas/shared";

export const WEEKDAYS = [
  { weekday: 1, label: "Lunes" },
  { weekday: 2, label: "Martes" },
  { weekday: 3, label: "Miércoles" },
  { weekday: 4, label: "Jueves" },
  { weekday: 5, label: "Viernes" },
  { weekday: 6, label: "Sábado" },
  { weekday: 7, label: "Domingo" },
] as const;

export interface DayRow {
  weekday: number;
  open: boolean;
  opensAt: string;
  closesAt: string;
}

export function rowsFromOpeningHours(hours: readonly OpeningHoursDto[]): DayRow[] {
  return WEEKDAYS.map(({ weekday }) => {
    const h = hours.find((x) => x.weekday === weekday);
    return h
      ? { weekday, open: true, opensAt: h.opensAt, closesAt: h.closesAt }
      : { weekday, open: false, opensAt: "08:00", closesAt: "20:00" };
  });
}

/** Solo los días marcados como abiertos, en orden. El índice en el array es el que usan los errores de la API. */
export function openingHoursFromRows(rows: readonly DayRow[]): OpeningHoursDto[] {
  return rows.filter((r) => r.open).map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt }));
}

/**
 * Traduce los errores de la API (`openingHours[i]…`, índice del array enviado) a errores por día de la grilla.
 * Devuelve un mapa weekday → mensaje.
 */
export function rowErrors(rows: readonly DayRow[], fieldErrors: Record<string, string>): Record<number, string> {
  const sent = openingHoursFromRows(rows);
  const out: Record<number, string> = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const m = path.match(/^openingHours\[(\d+)\]/);
    const day = m ? sent[Number(m[1])] : undefined;
    if (day) out[day.weekday] = out[day.weekday] ? `${out[day.weekday]} ${message}` : message;
  }
  return out;
}
