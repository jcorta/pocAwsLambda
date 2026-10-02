// Soporte de los E2E de la API contra el entorno local en Floci (SPEC §8).
// Requiere `pnpm local:up`: lee la URL de la API y los datos de Cognito de apps/web/public/config.json.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Temporal } from "temporal-polyfill";

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/config.json");

interface LocalConfig {
  apiUrl: string;
  cognito: { region: string; userPoolId: string; clientId: string; endpoint: string };
  timezone: string;
}

export function loadConfig(): LocalConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error("No existe apps/web/public/config.json: levantar el entorno con `pnpm local:up`");
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as LocalConfig;
}

export const config = loadConfig();

const cognito = new CognitoIdentityProviderClient({
  region: config.cognito.region,
  endpoint: config.cognito.endpoint,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

export interface TestUser {
  email: string;
  idToken: string;
  accessToken: string;
}

/** Usuario propio de cada test (SPEC §8.3), creado confirmado y sin email de invitación. */
export async function createUser({ admin = false } = {}): Promise<TestUser> {
  const email = `e2e+${randomUUID()}@example.com`;
  const password = "E2e-pass-1";
  const UserPoolId = config.cognito.userPoolId;
  await cognito.send(
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
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId, Username: email, Password: password, Permanent: true }),
  );
  if (admin) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: "admin" }));
  const auth = await cognito.send(
    new InitiateAuthCommand({
      ClientId: config.cognito.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  return { email, idToken: auth.AuthenticationResult!.IdToken!, accessToken: auth.AuthenticationResult!.AccessToken! };
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // no era JSON: se deja el texto
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * Una fecha local a `days` días de hoy, con turnos que no dependen de la hora en que corre el test:
 * a 2 o más días, siempre hay más de 2 h de anticipación para cancelar (RN-06).
 */
export function dayFromToday(days: number): string {
  return Temporal.Now.plainDateISO(config.timezone).add({ days }).toString();
}

export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "12:00" }));
