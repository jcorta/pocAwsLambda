import { describe, expect, it } from "vitest";
import { apiPath } from "./index.ts";

describe("@reservas/web", () => {
  it("arma rutas de la API con la versión de @reservas/shared", () => {
    expect(apiPath("/resources")).toBe("/v1/resources");
  });
});
