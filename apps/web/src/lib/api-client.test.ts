import { MeSchema } from "@reservas/shared";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client.ts";
import { ApiError } from "./errors.ts";

const ME = { id: "user-1", email: "user@example.com", roles: ["user"] };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(responses: Response[], { refreshOk = true } = {}) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  let token = "token-1";
  const forceRefresh = vi.fn(async () => {
    if (refreshOk) token = "token-2";
    return refreshOk;
  });
  const onSessionExpired = vi.fn();
  const api = createApiClient({
    baseUrl: "http://api",
    getIdToken: async () => token,
    forceRefresh,
    onSessionExpired,
    fetchImpl,
  });
  return { api, fetchImpl, forceRefresh, onSessionExpired };
}

const authHeader = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

describe("createApiClient", () => {
  it("envía el ID token y valida la respuesta con el esquema del contrato", async () => {
    const { api, fetchImpl } = setup([json(200, ME)]);
    await expect(api("GET", "/v1/me", { schema: MeSchema })).resolves.toEqual(ME);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api/v1/me");
    expect(authHeader(fetchImpl.mock.calls[0]!)["authorization"]).toBe("Bearer token-1");
  });

  it("arma el query string sin los valores vacíos", async () => {
    const { api, fetchImpl } = setup([json(200, ME)]);
    await api("GET", "/v1/bookings/me", { schema: MeSchema, query: { scope: "past", cursor: undefined, limit: "" } });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://api/v1/bookings/me?scope=past");
  });

  it("ante un 401 refresca una vez y reintenta con el token nuevo (SPEC §5.3)", async () => {
    const { api, fetchImpl, forceRefresh, onSessionExpired } = setup([json(401, {}), json(200, ME)]);
    await expect(api("GET", "/v1/me", { schema: MeSchema })).resolves.toEqual(ME);
    expect(forceRefresh).toHaveBeenCalledOnce();
    expect(authHeader(fetchImpl.mock.calls[1]!)["authorization"]).toBe("Bearer token-2");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("si el refresh no alcanza, avisa que la sesión venció y no reintenta en bucle", async () => {
    const { api, fetchImpl, onSessionExpired } = setup([json(401, {})], { refreshOk: false });
    await expect(api("GET", "/v1/me", { schema: MeSchema })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("convierte el formato de error de la API en ApiError con code y details", async () => {
    const { api } = setup([
      json(409, { error: { code: "SLOT_TAKEN", message: "x", details: { mine: false }, requestId: "r" } }),
    ]);
    const err = await api("POST", "/v1/bookings", { schema: MeSchema, body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "SLOT_TAKEN", details: { mine: false } });
  });

  it("un error sin el formato del contrato se trata como INTERNAL_ERROR", async () => {
    const { api } = setup([new Response("Bad Gateway", { status: 502 })]);
    await expect(api("GET", "/v1/me", { schema: MeSchema })).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL_ERROR",
    });
  });

  it("una falla de red es NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = createApiClient({
      baseUrl: "http://api",
      getIdToken: async () => "t",
      forceRefresh: async () => false,
      onSessionExpired: () => {},
      fetchImpl,
    });
    await expect(api("GET", "/v1/me", { schema: MeSchema })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
