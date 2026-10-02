// Pasos de despliegue en Floci que comparten `local:up` y `deploy:local`.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AWS, fail, info, node, ROOT, step, terraform, terraformOutputs } from "./lib.mjs";

export function buildLambdas() {
  step("Build de las Lambdas (esbuild)");
  node("services/api/scripts/build.mjs");
}

export function applyInfra() {
  step("Terraform apply en infra/envs/local (la primera vez tarda ~2 min por RDS)");
  terraform(["init", "-input=false", "-no-color"], { capture: true });
  terraform(["apply", "-auto-approve", "-input=false", "-no-color", "-compact-warnings"]);
  return terraformOutputs();
}

export async function migrate(outputs) {
  step("Migraciones (Lambda migrator)");
  const lambda = new LambdaClient(AWS);
  const res = await lambda.send(new InvokeCommand({ FunctionName: outputs.migrator_function_name }));
  const payload = res.Payload ? new TextDecoder().decode(res.Payload) : "";
  if (res.FunctionError) fail(`El migrator falló: ${payload}`);
  const { applied } = JSON.parse(payload);
  info(`${applied} migraciones aplicadas`);
}

/** Config de runtime del frontend (SPEC §5.2), para `pnpm dev`. No se versiona ni entra al build. */
export function writeWebConfig(outputs, env) {
  const config = {
    // Rutas del proxy de `pnpm dev`: en Floci ni Cognito ni la API devuelven CORS (hallazgos A8 y A9)
    apiUrl: "/_floci/api",
    cognito: {
      region: "us-east-1",
      userPoolId: outputs.user_pool_id,
      clientId: outputs.user_pool_client_id,
      endpoint: "/_floci/cognito",
    },
    timezone: env.APP_TIMEZONE ?? "America/Argentina/Buenos_Aires",
  };
  const dir = join(ROOT, "apps", "web", "public");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  info("apps/web/public/config.json actualizado");
}
