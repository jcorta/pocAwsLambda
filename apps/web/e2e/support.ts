// Soporte de los E2E de UI: usuarios en Cognito y recursos por la API, contra el entorno local en Floci.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "../src/lib/config.ts";

export const PASSWORD = "E2e-ui-pass1";

let cached: RuntimeConfig | undefined;

/** La misma config que lee el sitio: así los tests usan exactamente el entorno desplegado. */
export async function runtimeConfig(baseURL: string): Promise<RuntimeConfig> {
  cached ??= (await (await fetch(new URL("config.json", baseURL))).json()) as RuntimeConfig;
  return cached;
}

function cognito(config: RuntimeConfig) {
  return new CognitoIdentityProviderClient({
    region: config.cognito.region,
    ...(config.cognito.endpoint ? { endpoint: config.cognito.endpoint } : {}),
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
}

export async function createUser(baseURL: string, { admin = false } = {}): Promise<string> {
  const config = await runtimeConfig(baseURL);
  const client = cognito(config);
  const email = `ui+${randomUUID()}@example.com`;
  const UserPoolId = config.cognito.userPoolId;
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
    }),
  );
  await client.send(
    new AdminSetUserPasswordCommand({ UserPoolId, Username: email, Password: PASSWORD, Permanent: true }),
  );
  if (admin) await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: "admin" }));
  return email;
}

/** Crea un recurso abierto todos los días de 08:00 a 12:00, con turnos de 60 min, por la API. */
export async function createResource(baseURL: string, adminEmail: string): Promise<string> {
  const config = await runtimeConfig(baseURL);
  const auth = await cognito(config).send(
    new InitiateAuthCommand({
      ClientId: config.cognito.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: adminEmail, PASSWORD },
    }),
  );
  const name = `Sala UI ${randomUUID().slice(0, 8)}`;
  const res = await fetch(`${config.apiUrl}/v1/admin/resources`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.AuthenticationResult!.IdToken!}`, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      slotMinutes: 60,
      openingHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "12:00" })),
    }),
  });
  expect(res.status).toBe(201);
  return name;
}

interface CapturedEmail {
  Destination: { ToAddresses: string[] };
  Subject: string;
  Body: { text_part: string | null };
}

/** Último email que recibió `to` según el SES de Floci (`/_aws/ses`). Espera hasta 15 s. */
export async function lastEmailTo(baseURL: string, to: string): Promise<CapturedEmail> {
  const config = await runtimeConfig(baseURL);
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const body = (await (await fetch(`${config.cognito.endpoint}/_aws/ses`)).json()) as { messages?: CapturedEmail[] };
    const found = (body.messages ?? []).filter((m) => m.Destination.ToAddresses.includes(to)).at(-1);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó ningún email para ${to}`);
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

/** Fecha local (YYYY-MM-DD) a `days` días de hoy en la zona del sistema. */
export function dayFromToday(timezone: string, days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
}
