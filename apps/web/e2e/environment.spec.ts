// Chequeos del entorno del navegador que necesita el login con Cognito desde el sitio en S3.
import { expect, test } from "@playwright/test";
import { runtimeConfig } from "./support.ts";
import "./diagnostics.ts";

test("el navegador puede hablar con Cognito desde el origen del sitio", async ({ page, baseURL }) => {
  const config = await runtimeConfig(baseURL!);
  await page.goto("/login/");

  const env = await page.evaluate(() => ({
    origin: location.origin,
    isSecureContext: window.isSecureContext,
    hasRandomUUID: typeof crypto.randomUUID === "function",
  }));
  console.log(`[entorno] ${JSON.stringify(env)}`);

  // Preflight CORS hacia Cognito de Floci, como lo haría el SDK desde el navegador
  const preflight = await fetch(config.cognito.endpoint ?? "", {
    method: "OPTIONS",
    headers: {
      origin: env.origin,
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "content-type,x-amz-target,x-amz-user-agent,amz-sdk-invocation-id,amz-sdk-request",
    },
  });
  const cors = {
    status: preflight.status,
    allowOrigin: preflight.headers.get("access-control-allow-origin"),
    allowHeaders: preflight.headers.get("access-control-allow-headers"),
    allowMethods: preflight.headers.get("access-control-allow-methods"),
  };
  console.log(`[cors cognito] ${JSON.stringify(cors)}`);

  // Llamada real desde la página: InitiateAuth con un usuario inexistente debe responder un error de Cognito, no de red
  const fromPage = await page.evaluate(
    async ({ endpoint, clientId }) => {
      try {
        const res = await fetch(endpoint, {
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
        return { ok: true, status: res.status, body: (await res.text()).slice(0, 200) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    { endpoint: config.cognito.endpoint ?? "", clientId: config.cognito.clientId },
  );
  console.log(`[fetch desde la página] ${JSON.stringify(fromPage)}`);

  expect(fromPage.ok, "el navegador bloqueó la llamada a Cognito (¿CORS?)").toBe(true);
});
