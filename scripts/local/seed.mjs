#!/usr/bin/env node
// Seed del entorno local y de la CI (SPEC §10.2). Nunca se ejecuta contra AWS real.
// Idempotente: se puede correr varias veces sin duplicar usuarios ni recursos.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { pathToFileURL } from "node:url";
import { AWS, fail, info, loadEnv, step, terraformOutputs } from "./lib.mjs";

const WEEKDAYS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "20:00" }));

/** SPEC §3.4: 3 recursos de lunes a viernes, de 08:00 a 20:00, con turnos de 30, 60 y 120 minutos. */
const RESOURCES = [
  {
    name: "Sala Azul",
    description: "Sala de reuniones con TV, 8 personas",
    attributes: { capacidad: 8 },
    slotMinutes: 30,
  },
  { name: "Cancha de pádel", description: "Cancha techada", attributes: { techada: true }, slotMinutes: 60 },
  { name: "Proyector portátil", description: "Proyector con HDMI", attributes: { hdmi: true }, slotMinutes: 120 },
];

/** Crea el usuario ya confirmado y sin email de invitación (SPEC §2.4, nota de CU-10). */
async function ensureUser(cognito, poolId, { email, password, admin }) {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
  } catch (err) {
    // Con el email como nombre de usuario, Floci responde AliasExistsException si ya existe
    if (err.name !== "UsernameExistsException" && err.name !== "AliasExistsException") throw err;
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: email, Password: password, Permanent: true }),
  );
  if (admin)
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: email, GroupName: "admin" }));
}

async function idToken(cognito, clientId, email, password) {
  const r = await cognito.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  return r.AuthenticationResult.IdToken;
}

async function api(outputs, method, path, token, body) {
  const res = await fetch(`${outputs.api_url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) fail(`${method} ${path} respondió ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export async function seed(outputs = terraformOutputs(), env = loadEnv()) {
  step("Seed: usuarios de Cognito y recursos de ejemplo");
  const cognito = new CognitoIdentityProviderClient(AWS);
  const users = [
    { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, admin: true },
    { email: env.SEED_USER_EMAIL, password: env.SEED_USER_PASSWORD, admin: false },
  ];
  if (users.some((u) => !u.email || !u.password)) fail("Faltan SEED_*_EMAIL o SEED_*_PASSWORD en .env.local");

  for (const u of users) {
    await ensureUser(cognito, outputs.user_pool_id, u);
    // GET /v1/me registra al usuario en la tabla users (SPEC §3.2)
    await api(outputs, "GET", "/v1/me", await idToken(cognito, outputs.user_pool_client_id, u.email, u.password));
    info(`usuario ${u.email}${u.admin ? " (admin)" : ""}`);
  }

  // Los recursos se crean por la API, como lo haría un admin
  const adminToken = await idToken(cognito, outputs.user_pool_client_id, users[0].email, users[0].password);
  const existing = new Set(
    (await api(outputs, "GET", "/v1/resources?includeInactive=true", adminToken)).items.map((r) => r.name),
  );
  for (const r of RESOURCES) {
    if (existing.has(r.name)) {
      info(`recurso "${r.name}" (ya existía)`);
      continue;
    }
    await api(outputs, "POST", "/v1/admin/resources", adminToken, { ...r, openingHours: WEEKDAYS });
    info(`recurso "${r.name}" (turnos de ${r.slotMinutes} min)`);
  }
}

// Ejecución directa: `pnpm local:seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await seed();
