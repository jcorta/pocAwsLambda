import { ERROR_CODES } from "@reservas/shared";
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "./errors.ts";

describe("errorMessage (SPEC §5.5)", () => {
  it("cada código del catálogo tiene un mensaje en español", () => {
    for (const code of ERROR_CODES) expect(errorMessage(new ApiError(400, code, "x"))).not.toBe("");
  });

  it("usa los details para dar un mensaje más preciso", () => {
    expect(errorMessage(new ApiError(409, "BOOKING_LIMIT_REACHED", "x", { limit: 3 }))).toBe(
      "Alcanzaste el máximo de 3 reservas activas.",
    );
    expect(errorMessage(new ApiError(409, "CANCELLATION_WINDOW_CLOSED", "x", { minHours: 2 }))).toContain("2 h");
  });

  it("expone los errores por campo de VALIDATION_ERROR", () =>
    expect(
      new ApiError(400, "VALIDATION_ERROR", "x", { fields: [{ path: "name", message: "Requerido" }] }).fieldErrors,
    ).toEqual({ name: "Requerido" }));
});
