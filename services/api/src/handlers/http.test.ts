import { ERROR_CODES, ErrorResponseSchema, ReplaceResourceSchema } from "@reservas/shared";
import { describe, expect, it } from "vitest";
import { reject } from "../domain/types.ts";
import { bodyOf, httpEvent } from "./__fixtures__/events.ts";
import { errorResponse, HTTP_STATUS, parseBody, pathId } from "./http.ts";

describe("errorResponse (SPEC §4.2 y §4.3)", () => {
  it("cada código del catálogo tiene su HTTP", () => {
    for (const code of ERROR_CODES) expect(HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ["SLOT_TAKEN", 409],
    ["VALIDATION_ERROR", 400],
    ["FORBIDDEN", 403],
    ["BOOKING_NOT_FOUND", 404],
    ["INVALID_TOKEN_TYPE", 401],
    ["INTERNAL_ERROR", 500],
  ] as const)("%s → %i", (code, status) => expect(errorResponse(reject(code), "r").statusCode).toBe(status));

  it("respeta el formato de error del contrato e incluye requestId y details", () => {
    const res = errorResponse(reject("SLOT_TAKEN", { mine: true }), "req-9");
    expect(res.headers).toMatchObject({ "content-type": "application/json", "x-request-id": "req-9" });
    const body = ErrorResponseSchema.parse(bodyOf(res));
    expect(body.error).toMatchObject({ code: "SLOT_TAKEN", details: { mine: true }, requestId: "req-9" });
  });
});

describe("parseBody", () => {
  const event = (body?: string, isBase64Encoded = false) => ({
    ...httpEvent({ routeKey: "PUT /v1/admin/resources/{id}", ...(body !== undefined ? { body } : {}) }),
    isBase64Encoded,
  });

  it("valida con el esquema y arma details.fields con rutas legibles", () => {
    const r = parseBody(
      event(
        JSON.stringify({
          name: "Sala",
          slotMinutes: 60,
          isActive: true,
          openingHours: [{ weekday: 1, opensAt: "08:00", closesAt: "8pm" }],
        }),
      ),
      ReplaceResourceSchema,
    );
    expect(r).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(!r.ok && r.details?.["fields"]).toEqual([
      { path: "openingHours[0].closesAt", message: "Hora inválida (formato HH:mm)" },
    ]);
  });

  it("rechaza un body ausente o que no es JSON", () => {
    expect(parseBody(event(), ReplaceResourceSchema)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(parseBody(event("{no es json"), ReplaceResourceSchema)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("decodifica un body en base64", () => {
    const raw = JSON.stringify({ name: "Sala", slotMinutes: 60, isActive: false, openingHours: [] });
    const r = parseBody(event(Buffer.from(raw).toString("base64"), true), ReplaceResourceSchema);
    expect(r.ok && r.data.isActive).toBe(false);
  });
});

describe("pathId", () => {
  it("devuelve un UUID válido", () =>
    expect(
      pathId(
        httpEvent({
          routeKey: "GET /v1/resources/{id}",
          pathParameters: { id: "0b6f0c2e-6a39-4bd2-9b9e-3a52c2c3a1f4" },
        }),
      ),
    ).toBe("0b6f0c2e-6a39-4bd2-9b9e-3a52c2c3a1f4"));
  it("devuelve null si no es UUID (se responde 404 sin consultar la base)", () =>
    expect(pathId(httpEvent({ routeKey: "GET /v1/resources/{id}", pathParameters: { id: "1; drop" } }))).toBeNull());
});
