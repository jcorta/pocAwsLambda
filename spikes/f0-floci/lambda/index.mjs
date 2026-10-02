// Lambda de diagnóstico del spike F0: reporta qué ve desde adentro de Floci.
import pg from "pg";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function step(name, fn) {
  try {
    return { name, ok: true, result: await fn() };
  } catch (err) {
    return { name, ok: false, error: `${err.name}: ${err.message}` };
  }
}

export const handler = async (event) => {
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? null;
  const groups = claims?.["cognito:groups"];

  const checks = [];

  const secret = await step("secretsmanager", async () => {
    const sm = new SecretsManagerClient({});
    const out = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
    return JSON.parse(out.SecretString);
  });
  checks.push({ ...secret, result: secret.ok ? { host: secret.result.host, port: secret.result.port } : undefined });

  if (secret.ok) {
    const { host, port, username, password, dbname } = secret.result;
    checks.push(
      await step("rds", async () => {
        const client = new pg.Client({ host, port, user: username, password, database: dbname, connectionTimeoutMillis: 5000 });
        await client.connect();
        try {
          const version = (await client.query("select version() as v")).rows[0].v;
          await client.query("create extension if not exists btree_gist");
          const ext = (await client.query("select extversion from pg_extension where extname = 'btree_gist'")).rows[0];
          return { version, btree_gist: ext?.extversion ?? null };
        } finally {
          await client.end();
        }
      }),
    );
  }

  checks.push(
    await step("sqs", async () => {
      // Sin esto, el SDK usa el host de QueueUrl (localhost:4566), que dentro del contenedor no es Floci
      const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
      const out = await sqs.send(
        new SendMessageCommand({ QueueUrl: process.env.QUEUE_URL, MessageBody: JSON.stringify({ spike: "f0", at: new Date().toISOString() }) }),
      );
      return { messageId: out.MessageId };
    }),
  );

  checks.push(
    await step("ses", async () => {
      const ses = new SESClient({});
      const out = await ses.send(
        new SendEmailCommand({
          Source: process.env.SES_FROM,
          Destination: { ToAddresses: [claims?.email ?? "user@example.com"] },
          Message: { Subject: { Data: "Spike F0" }, Body: { Text: { Data: "Email de prueba enviado desde la Lambda" } } },
        }),
      );
      return { messageId: out.MessageId };
    }),
  );

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      {
        routeKey: event?.routeKey,
        env: { AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? null, AWS_REGION: process.env.AWS_REGION ?? null },
        claims,
        groups: { value: groups ?? null, type: Array.isArray(groups) ? "array" : typeof groups },
        checks,
      },
      null,
      2,
    ),
  };
};
