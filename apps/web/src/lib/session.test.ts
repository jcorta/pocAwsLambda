import { describe, expect, it } from "vitest";
import { decodeJwt, needsRefresh, safeNext, sessionFromTokens } from "./session.ts";

const jwt = (payload: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("sesión en memoria (SPEC §5.3)", () => {
  it("decodifica el payload del JWT, incluidos caracteres no ASCII", () =>
    expect(decodeJwt(jwt({ email: "josé@example.com", exp: 1 }))).toEqual({ email: "josé@example.com", exp: 1 }));

  it("toma el vencimiento del ID token", () =>
    expect(
      sessionFromTokens({ idToken: jwt({ exp: 1_800_000_000 }), accessToken: "a", refreshToken: "r" }).expiresAt,
    ).toBe(1_800_000_000_000));

  it("pide renovar un minuto antes de que venza", () => {
    const s = { idToken: "", accessToken: "", refreshToken: "", expiresAt: 100_000 };
    expect(needsRefresh(s, 30_000)).toBe(false);
    expect(needsRefresh(s, 40_000)).toBe(true);
  });
});

describe("safeNext", () => {
  it("acepta rutas internas", () => expect(safeNext("/bookings/?x=1")).toBe("/bookings/?x=1"));
  it.each([null, "", "https://evil.example", "//evil.example"])("rechaza %j y vuelve a /resources/", (next) =>
    expect(safeNext(next)).toBe("/resources/"),
  );
});
