// Adaptador HTTP (API Gateway HTTP API, payload 2.0): respuestas, errores y validación (SPEC §4.1 a §4.3).
import type { ErrorCode, ErrorResponse } from "@reservas/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { z } from "zod";
import { reject, type RuleFailure } from "../domain/types.ts";

export type HttpEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type HttpResult = APIGatewayProxyStructuredResultV2;

/** Código HTTP de cada error del catálogo (SPEC §4.3). */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_SLOT: 400,
  DATE_OUT_OF_RANGE: 400,
  INVALID_TOKEN_TYPE: 401,
  FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  BOOKING_LIMIT_REACHED: 409,
  CANCELLATION_WINDOW_CLOSED: 409,
  BOOKING_ALREADY_STARTED: 409,
  BOOKING_ALREADY_CANCELLED: 409,
  RESOURCE_NAME_TAKEN: 409,
  INTERNAL_ERROR: 500,
};

/** Mensaje orientativo en español; el frontend decide por `code` (SPEC §4.2). */
const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Los datos enviados no son válidos.",
  INVALID_SLOT: "El horario no corresponde a un turno válido del recurso.",
  DATE_OUT_OF_RANGE: "La fecha está fuera del rango permitido.",
  INVALID_TOKEN_TYPE: "Se requiere un ID token de Cognito.",
  FORBIDDEN: "No tenés permisos para esta operación.",
  RESOURCE_NOT_FOUND: "El recurso no existe.",
  BOOKING_NOT_FOUND: "La reserva no existe.",
  ROUTE_NOT_FOUND: "La ruta no existe.",
  SLOT_TAKEN: "El turno ya fue reservado.",
  BOOKING_LIMIT_REACHED: "Alcanzaste el límite de reservas activas.",
  CANCELLATION_WINDOW_CLOSED: "Ya no se puede cancelar: falta menos de la anticipación mínima.",
  BOOKING_ALREADY_STARTED: "La reserva ya empezó.",
  BOOKING_ALREADY_CANCELLED: "La reserva ya está cancelada.",
  RESOURCE_NAME_TAKEN: "Ya existe un recurso con ese nombre.",
  INTERNAL_ERROR: "Ocurrió un error inesperado.",
};

export function json(statusCode: number, body: unknown, requestId: string): HttpResult {
  return {
    statusCode,
    headers: { "content-type": "application/json", "x-request-id": requestId },
    body: JSON.stringify(body),
  };
}

export function errorResponse(failure: RuleFailure, requestId: string): HttpResult {
  const body: ErrorResponse = {
    error: {
      code: failure.code,
      message: MESSAGES[failure.code],
      ...(failure.details ? { details: failure.details } : {}),
      requestId,
    },
  };
  return json(HTTP_STATUS[failure.code], body, requestId);
}

/** Convierte los errores de Zod en `details.fields` (SPEC §4.2). */
function toValidationFailure(error: z.ZodError, prefix = ""): RuleFailure {
  const fields = error.issues.map((issue) => ({
    path:
      prefix +
      issue.path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join(""),
    message: issue.message,
  }));
  return reject("VALIDATION_ERROR", { fields });
}

export type Parsed<T> = { ok: true; data: T } | RuleFailure;

export function validate<S extends z.ZodType>(schema: S, value: unknown): Parsed<z.infer<S>> {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, data: r.data } : toValidationFailure(r.error);
}

export function parseBody<S extends z.ZodType>(event: HttpEvent, schema: S): Parsed<z.infer<S>> {
  if (!event.body) return reject("VALIDATION_ERROR", { fields: [{ path: "", message: "Falta el body" }] });
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return reject("VALIDATION_ERROR", { fields: [{ path: "", message: "El body no es JSON válido" }] });
  }
  return validate(schema, value);
}

export function parseQuery<S extends z.ZodType>(event: HttpEvent, schema: S): Parsed<z.infer<S>> {
  return validate(schema, event.queryStringParameters ?? {});
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{id}` de la ruta. Un id que no es UUID no puede existir: se responde 404 sin consultar la base. */
export function pathId(event: HttpEvent): string | null {
  const id = event.pathParameters?.["id"];
  return id && UUID.test(id) ? id : null;
}
