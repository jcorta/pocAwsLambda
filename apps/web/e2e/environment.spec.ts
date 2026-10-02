// Chequeo del entorno del navegador que necesita el login con Cognito (hallazgo A8 de docs/spikes/floci.md):
// el sitio se sirve por el proxy del mismo origen, que es un contexto seguro y reenvía Cognito sin CORS.
import { expect, test } from "@playwright/test";
import "./diagnostics.ts";
import { runtimeConfig } from "./support.ts";

test("el navegador llega a Cognito por el proxy del mismo origen, en un contexto seguro", async ({ page, baseURL }) => {
  const config = await runtimeConfig(baseURL!);
  expect(config.cognito.endpoint, "en local, Cognito va por el proxy").toBe("/_floci/cognito");

  await page.goto("/login/");
  const env = await page.evaluate(() => ({
    origin: location.origin,
    isSecureContext: window.isSecureContext,
    hasRandomUUID: typeof crypto.randomUUID === "function",
  }));
  expect(env).toMatchObject({ isSecureContext: true, hasRandomUUID: true });

  // InitiateAuth con un usuario inexistente: tiene que llegar a Cognito y responder su error, no uno de red
  const result = await page.evaluate(
    async ({ clientId }) => {
      try {
        const res = await fetch("/_floci/cognito", {
          method: "POST",
          headers: {
            "content-type": "application/x-amz-json-1.1",
            "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
          },
          body: JSON.stringify({
            ClientId: clientId,
            AuthFlow: "USER_PASSWORD_AUTH",
            AuthParameters: { USERNAME: "nadie@example.com", PASSWORD: "x" },
          }),
        });
        return { ok: true, status: res.status, body: await res.text() };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    { clientId: config.cognito.clientId },
  );

  expect(result.ok, `el navegador no llegó a Cognito: ${JSON.stringify(result)}`).toBe(true);
  expect(result.body).toMatch(/NotAuthorized|UserNotFound/);

  // La API también por el proxy (hallazgo A9): sin token, el JWT authorizer responde 401
  expect(config.apiUrl, "en local, la API va por el proxy").toBe("/_floci/api");
  const api = await page.evaluate(async () => {
    try {
      return { ok: true, status: (await fetch("/_floci/api/v1/me")).status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  expect(api).toEqual({ ok: true, status: 401 });
});
