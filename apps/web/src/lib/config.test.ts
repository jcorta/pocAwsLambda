import { describe, expect, it, vi } from "vitest";
import { cognitoEndpoint, loadRuntimeConfig, type RuntimeConfig } from "./config.ts";
import { passwordProblems } from "./password.ts";

const valid = {
  apiUrl: "http://abc.execute-api.localhost.floci.io:4566",
  cognito: { region: "us-east-1", userPoolId: "us-east-1_x", clientId: "c", endpoint: "http://localhost:4566" },
  timezone: "America/Argentina/Buenos_Aires",
};

describe("loadRuntimeConfig (SPEC §5.2)", () => {
  it("lee y valida /config.json", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(valid)));
    await expect(loadRuntimeConfig(fetchImpl)).resolves.toEqual(valid);
    expect(fetchImpl.mock.calls[0]![0]).toBe("/config.json");
  });

  it("el endpoint de Cognito es opcional (en AWS se omite)", async () => {
    const cognito = {
      region: valid.cognito.region,
      userPoolId: valid.cognito.userPoolId,
      clientId: valid.cognito.clientId,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...valid, cognito })));
    await expect(loadRuntimeConfig(fetchImpl)).resolves.toMatchObject({ cognito: { clientId: "c" } });
  });

  it("acepta una ruta del mismo origen para Cognito y la resuelve contra la página (hallazgo A8)", async () => {
    const relative = { ...valid, cognito: { ...valid.cognito, endpoint: "/_floci/cognito" } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(relative)));
    const config = await loadRuntimeConfig(fetchImpl);
    expect(cognitoEndpoint(config, "http://localhost:3002")).toBe("http://localhost:3002/_floci/cognito");
  });

  it("deja una URL absoluta como está, y sin endpoint usa el de AWS", () => {
    expect(cognitoEndpoint(valid, "http://localhost:3000")).toBe("http://localhost:4566");
    const aws = { ...valid, cognito: { region: "us-east-1", userPoolId: "p", clientId: "c" } } as RuntimeConfig;
    expect(cognitoEndpoint(aws, "https://reservas.example.com")).toBeUndefined();
  });

  it("rechaza un endpoint que no es URL ni ruta", async () => {
    const bad = { ...valid, cognito: { ...valid.cognito, endpoint: "localhost:4566" } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(bad)));
    await expect(loadRuntimeConfig(fetchImpl)).rejects.toThrow();
  });

  it("falla con un mensaje claro si no existe", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }));
    await expect(loadRuntimeConfig(fetchImpl)).rejects.toThrow("HTTP 404");
  });
});

describe("passwordProblems (política de Cognito, SPEC §7.4)", () => {
  it("acepta una contraseña válida", () => expect(passwordProblems("Abcdefg1")).toEqual([]));
  it("lista lo que falta", () =>
    expect(passwordProblems("abc")).toEqual(["al menos 8 caracteres", "una mayúscula", "un número"]));
});
