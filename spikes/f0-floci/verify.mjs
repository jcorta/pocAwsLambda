// Verificación del spike F0. Uso: docker compose run --rm terraform output -json > outputs.json && node verify.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand,
  GlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { SecretsManagerClient, ListSecretsCommand, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SQSClient, ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";

const FLOCI = "http://localhost:4566";
const aws = { region: "us-east-1", endpoint: FLOCI, credentials: { accessKeyId: "test", secretAccessKey: "test" } };
const out = Object.fromEntries(Object.entries(JSON.parse(readFileSync("outputs.json", "utf8"))).map(([k, v]) => [k, v.value]));

const results = [];
const record = (point, name, ok, detail) => {
  results.push({ point, name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} [${point}] ${name}`);
  if (detail !== undefined) console.log("   ", typeof detail === "string" ? detail : JSON.stringify(detail));
};
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// --- Cognito: usuario confirmado sin email, en el grupo admin ---
const cognito = new CognitoIdentityProviderClient(aws);
const email = `admin+${Date.now()}@example.com`;
const password = "Spike-F0-pass1";
await cognito.send(
  new AdminCreateUserCommand({
    UserPoolId: out.user_pool_id,
    Username: email,
    MessageAction: "SUPPRESS",
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ],
  }),
);
await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: out.user_pool_id, Username: email, Password: password, Permanent: true }));
await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: out.user_pool_id, Username: email, GroupName: "admin" }));

const auth = await cognito.send(
  new InitiateAuthCommand({ ClientId: out.user_pool_client_id, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } }),
);
const { IdToken, AccessToken, RefreshToken } = auth.AuthenticationResult;
const id = decode(IdToken);
const access = decode(AccessToken);
record("1", "iss del ID token", true, id.iss);
record("1", "aud del ID token = clientId", id.aud === out.user_pool_client_id, { aud: id.aud });
record("4", "cognito:groups en ID token", id["cognito:groups"] !== undefined, { value: id["cognito:groups"] ?? null });
record("4", "cognito:groups en access token", access["cognito:groups"] !== undefined, { value: access["cognito:groups"] ?? null });
record("—", "email en ID token", id.email === email, { email: id.email, email_verified: id.email_verified });

const refreshed = await cognito.send(
  new InitiateAuthCommand({ ClientId: out.user_pool_client_id, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: RefreshToken } }),
).then(() => true, (e) => e.message);
record("—", "REFRESH_TOKEN_AUTH", refreshed === true, refreshed === true ? undefined : refreshed);

// --- API Gateway HTTP API ---
const apiBase = `http://${out.api_id}.execute-api.localhost.floci.io:4566`;
const probe = `${apiBase}/v1/probe`;
record("7", "URL de invocación usada", true, probe);

const noToken = await fetch(probe).then((r) => r.status, (e) => e.message);
record("1", "Sin token → 401", noToken === 401, { status: noToken });

const badToken = await fetch(probe, { headers: { Authorization: `Bearer ${IdToken.slice(0, -4)}xxxx` } }).then((r) => r.status, (e) => e.message);
record("1", "Token con firma inválida → 401", badToken === 401, { status: badToken });

// Igual que en AWS: si el token no trae `aud`, el authorizer compara `client_id` con la audiencia,
// así que el access token también pasa. La Lambda debe exigir token_use = "id".
const withAccess = await fetch(probe, { headers: { Authorization: `Bearer ${AccessToken}` } }).then(
  async (r) => ({ status: r.status, token_use: (await r.json().catch(() => ({})))?.claims?.token_use ?? null }),
  (e) => ({ error: e.message }),
);
record("1", "Access token también pasa el authorizer (como en AWS)", withAccess.status === 200, withAccess);

const res = await fetch(probe, { headers: { Authorization: `Bearer ${IdToken}` } });
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}
record("1", "ID token → 200 (JWT authorizer acepta el emisor de Floci)", res.status === 200, { status: res.status });

if (res.status === 200 && typeof body === "object") {
  record("2", "AWS_ENDPOINT_URL dentro de la Lambda", !!body.env.AWS_ENDPOINT_URL, body.env);
  record("4", "Formato de cognito:groups en requestContext", true, body.groups);
  for (const c of body.checks) record(c.name === "rds" ? "3" : "2", `Lambda → ${c.name}`, c.ok, c.ok ? c.result : c.error);
} else {
  record("1", "Respuesta de la API", false, body);
}

const preflight = await fetch(probe, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
}).then(
  (r) => ({ status: r.status, allowOrigin: r.headers.get("access-control-allow-origin"), allowHeaders: r.headers.get("access-control-allow-headers") }),
  (e) => ({ error: e.message }),
);
record("7", "CORS preflight desde http://localhost:3000", preflight.allowOrigin === "http://localhost:3000", preflight);

const preflightBad = await fetch(probe, {
  method: "OPTIONS",
  headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "GET" },
}).then((r) => r.headers.get("access-control-allow-origin"), (e) => e.message);
record("7", "CORS rechaza otro origen", preflightBad !== "http://evil.example" && preflightBad !== "*", { allowOrigin: preflightBad });

// --- SES capturado ---
await new Promise((r) => setTimeout(r, 1000));
const ses = await fetch(`${FLOCI}/_aws/ses`).then((r) => r.json(), (e) => ({ error: e.message }));
const msgs = ses.messages ?? ses;
const mine = Array.isArray(msgs) ? msgs.filter((m) => JSON.stringify(m).includes(email)) : [];
record("2", "Email capturado en /_aws/ses", mine.length > 0, { total: Array.isArray(msgs) ? msgs.length : msgs, sample: mine[0] ?? null });

// --- SQS → Lambda consumidora (event source mapping) ---
const sqs = new SQSClient(aws);
const waitFor = async (fn, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
};
const marker = `ok-${Date.now()}`;
await sqs.send(new SendMessageCommand({ QueueUrl: out.queue_url, MessageBody: JSON.stringify({ marker }) }));
const consumed = await waitFor(async () => {
  const all = await fetch(`${FLOCI}/_aws/ses`).then((r) => r.json());
  return (all.messages ?? all).find((m) => m.Subject === `consumer ${marker}`);
}, 30000);
record("ESM", "SQS dispara la Lambda consumidora (email enviado)", !!consumed, consumed ? { subject: consumed.Subject } : "timeout 30 s");

const failMarker = `fail-${Date.now()}`;
await sqs.send(new SendMessageCommand({ QueueUrl: out.queue_url, MessageBody: JSON.stringify({ marker: failMarker, fail: true }) }));
const inDlq = await waitFor(async () => {
  const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: out.dlq_url, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
  return r.Messages?.find((m) => m.Body.includes(failMarker));
}, 90000);
record("ESM", "Mensaje fallido (ReportBatchItemFailures) llega a la DLQ tras 3 intentos", !!inDlq, inDlq ? { receiveCount: inDlq.Attributes?.ApproximateReceiveCount ?? "?" } : "timeout 90 s");

// --- RDS desde el host ---
const sm = new SecretsManagerClient(aws);
const secretList = await sm.send(new ListSecretsCommand({}));
const secretArn = secretList.SecretList.find((s) => s.Name === "f0-spike-db").ARN;
const secret = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: secretArn }))).SecretString);
const hostDb = await (async () => {
  const c = new pg.Client({ host: "localhost", port: secret.port, user: secret.username, password: secret.password, database: secret.dbname, connectionTimeoutMillis: 5000 });
  await c.connect();
  try {
    return (await c.query("select current_database() as db")).rows[0];
  } finally {
    await c.end();
  }
})().then((r) => ({ ok: true, r }), (e) => ({ ok: false, r: e.message }));
record("3", `RDS desde el host (localhost:${secret.port})`, hostDb.ok, hostDb.r);

// --- S3 website ---
const siteCandidates = [
  `http://${out.site_bucket}.s3-website.localhost.floci.io:4566/`,
  `http://${out.site_bucket}.s3-website-us-east-1.localhost.floci.io:4566/`,
  `http://${out.site_bucket}.s3.localhost.floci.io:4566/index.html`,
  `${FLOCI}/${out.site_bucket}/index.html`,
];
for (const url of siteCandidates) {
  const r = await fetch(url).then(async (x) => ({ status: x.status, ok: (await x.text()).includes("Spike F0 OK") }), (e) => ({ error: e.message }));
  record("7", `Sitio S3: ${url}`, r.ok === true, r);
}

// --- Logout ---
const signOut = await cognito.send(new GlobalSignOutCommand({ AccessToken })).then(() => true, (e) => e.message);
record("—", "GlobalSignOut con access token", signOut === true, signOut === true ? undefined : signOut);
const refreshAfter = await cognito.send(
  new InitiateAuthCommand({ ClientId: out.user_pool_client_id, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: RefreshToken } }),
).then(() => "aceptado", (e) => `rechazado: ${e.name}`);
record("—", "Refresh token revocado tras GlobalSignOut", refreshAfter.startsWith("rechazado"), refreshAfter);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} chequeos OK`);
// Código de salida distinto de 0 si algo falló, para que la CI lo detecte
process.exitCode = failed.length > 0 ? 1 : 0;
