import { describe, expect, it } from "vitest";
import { API_VERSION } from "./index.ts";

describe("@reservas/shared", () => {
  it("expone la versión de la API", () => {
    expect(API_VERSION).toBe("v1");
  });
});
