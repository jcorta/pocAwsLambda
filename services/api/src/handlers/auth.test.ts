import { describe, expect, it } from "vitest";
import { ADMIN_CLAIMS, httpEvent, USER_CLAIMS } from "./__fixtures__/events.ts";
import { actorFromEvent, parseGroups } from "./auth.ts";

describe("parseGroups (formato verificado en el spike F0)", () => {
  it.each([
    ["[admin]", ["admin"]],
    ["[admin user]", ["admin", "user"]],
    ["[]", []],
    ["admin", ["admin"]],
    ['["admin","user"]', ["admin", "user"]],
    ["[admin, user]", ["admin", "user"]],
  ])("acepta el string %j", (raw, expected) => expect(parseGroups(raw)).toEqual(expected));

  it("acepta un array", () => expect(parseGroups(["admin"])).toEqual(["admin"]));
  it("ignora valores que no son string ni array", () => expect(parseGroups(undefined)).toEqual([]));
});

describe("actorFromEvent", () => {
  it("arma el actor desde un ID token de user", () =>
    expect(actorFromEvent(httpEvent({ routeKey: "GET /v1/me" }))).toEqual({
      userId: "user-1",
      email: "user@example.com",
      isAdmin: false,
    }));

  it("reconoce al admin por cognito:groups", () =>
    expect(actorFromEvent(httpEvent({ routeKey: "GET /v1/me", claims: ADMIN_CLAIMS }))).toMatchObject({
      isAdmin: true,
    }));

  it("rechaza el access token con INVALID_TOKEN_TYPE (hallazgo A3)", () =>
    expect(
      actorFromEvent(httpEvent({ routeKey: "GET /v1/me", claims: { sub: "user-1", token_use: "access" } })),
    ).toEqual({ ok: false, code: "INVALID_TOKEN_TYPE" }));

  it("rechaza un ID token sin email", () =>
    expect(
      actorFromEvent(httpEvent({ routeKey: "GET /v1/me", claims: { ...USER_CLAIMS, email: undefined as never } })),
    ).toMatchObject({ code: "INVALID_TOKEN_TYPE" }));
});
