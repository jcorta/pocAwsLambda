// Errores de la API del lado del frontend (SPEC §4.2 y §5.5): el frontend decide por `code`.
import type { ErrorCode } from "@reservas/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK_ERROR" | "UNAUTHORIZED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** Errores por campo de VALIDATION_ERROR: { "openingHours[0].closesAt": "mensaje", ... } */
  get fieldErrors(): Record<string, string> {
    const fields = (this.details?.["fields"] ?? []) as { path: string; message: string }[];
    return Object.fromEntries(fields.map((f) => [f.path, f.message]));
  }
}

/** Mensaje en español para cada código (SPEC §5.5). */
const MESSAGES: Record<ApiError["code"], string> = {
  VALIDATION_ERROR: "Revisá los datos marcados.",
  INVALID_SLOT: "Ese horario no es un turno válido del recurso.",
  DATE_OUT_OF_RANGE: "La fecha está fuera del rango en el que se puede reservar.",
  INVALID_TOKEN_TYPE: "Tu sesión no es válida. Volvé a iniciar sesión.",
  FORBIDDEN: "No tenés permisos para esta acción.",
  RESOURCE_NOT_FOUND: "El recurso no existe o ya no está disponible.",
  BOOKING_NOT_FOUND: "La reserva no existe.",
  ROUTE_NOT_FOUND: "La operación no existe.",
  SLOT_TAKEN: "Alguien reservó ese turno recién. Elegí otro.",
  BOOKING_LIMIT_REACHED: "Alcanzaste el máximo de reservas activas.",
  CANCELLATION_WINDOW_CLOSED: "Ya no se puede cancelar: falta poco para el turno.",
  BOOKING_ALREADY_STARTED: "El turno ya empezó.",
  BOOKING_ALREADY_CANCELLED: "La reserva ya estaba cancelada.",
  RESOURCE_NAME_TAKEN: "Ya existe un recurso con ese nombre.",
  INTERNAL_ERROR: "Ocurrió un error inesperado. Probá de nuevo en unos minutos.",
  NETWORK_ERROR: "No se pudo conectar con el servidor. Revisá tu conexión.",
  UNAUTHORIZED: "Tu sesión venció. Volvé a iniciar sesión.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "BOOKING_LIMIT_REACHED" && typeof err.details?.["limit"] === "number") {
      return `Alcanzaste el máximo de ${err.details["limit"]} reservas activas.`;
    }
    if (err.code === "CANCELLATION_WINDOW_CLOSED" && typeof err.details?.["minHours"] === "number") {
      return `Ya no se puede cancelar: se permite hasta ${err.details["minHours"]} h antes del turno.`;
    }
    return MESSAGES[err.code];
  }
  return err instanceof Error ? err.message : MESSAGES.INTERNAL_ERROR;
}
