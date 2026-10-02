// Soporte de los E2E de la API contra el entorno local en Floci (SPEC §8).
// Requiere `pnpm local:up`: lee la URL de la API y los datos de Cognito de apps/web/public/config.json.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Temporal } from "temporal-polyfill";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CONFIG_FILE = join(ROOT, "apps/web/public/config.json");

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

/**
 * Los E2E corren en Node, donde no hay CORS: hablan directo con Floci y con la API. En config.json,
 * `apiUrl` y `cognito.endpoint` son rutas del proxy del mismo origen que usa el navegador (hallazgos A8 y A9).
 */
export const FLOCI_URL = process.env["FLOCI_URL"] ?? "http://localhost:4566";

/** URL absoluta de la API, de los outputs de Terraform (o de E2E_API_URL). */
export const API_URL =
  process.env["E2E_API_URL"] ??
  execFileSync(process.execPath, [join(ROOT, "scripts", "local", "output.mjs"), "api_url"], {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();

const cognito = new CognitoIdentityProviderClient({
  region: config.cognito.region,
  endpoint: FLOCI_URL,
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
  const res = await fetch(`${API_URL}${path}`, {
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

interface CapturedEmail {
  Destination: { ToAddresses: string[] };
  Subject: string;
  Body: { text_part: string | null; html_part: string | null };
}

/** Emails que capturó el SES de Floci (`/_aws/ses`, docs/spikes/floci.md). */
export async function capturedEmails(to: string): Promise<CapturedEmail[]> {
  const res = await fetch(`${FLOCI_URL}/_aws/ses`);
  const body = (await res.json()) as { messages?: CapturedEmail[] } | CapturedEmail[];
  const messages = Array.isArray(body) ? body : (body.messages ?? []);
  return messages.filter((m) => m.Destination.ToAddresses.includes(to));
}

/** Espera hasta que llegue un email que cumpla `match` (SPEC §8.2: hasta 15 s). */
export async function waitForEmail(
  to: string,
  match: (m: CapturedEmail) => boolean,
  timeoutMs = 15_000,
): Promise<CapturedEmail> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = (await capturedEmails(to)).find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó el email esperado para ${to} en ${timeoutMs} ms`);
}

export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "12:00" }));
