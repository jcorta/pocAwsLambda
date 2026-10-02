import { describe, expect, it } from "vitest";
import { basePath } from "./index.ts";

describe("@reservas/api", () => {
  it("arma el prefijo de rutas con la versión de @reservas/shared", () => {
    expect(basePath).toBe("/v1");
  });
});
