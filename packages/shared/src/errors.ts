// Catálogo de códigos de error de la API (SPEC §4.3). Agregar un código requiere agregarlo antes a la spec.
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INVALID_SLOT",
  "DATE_OUT_OF_RANGE",
  "INVALID_TOKEN_TYPE",
  "FORBIDDEN",
  "RESOURCE_NOT_FOUND",
  "BOOKING_NOT_FOUND",
  "ROUTE_NOT_FOUND",
  "SLOT_TAKEN",
  "BOOKING_LIMIT_REACHED",
  "CANCELLATION_WINDOW_CLOSED",
  "BOOKING_ALREADY_STARTED",
  "BOOKING_ALREADY_CANCELLED",
  "RESOURCE_NAME_TAKEN",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
