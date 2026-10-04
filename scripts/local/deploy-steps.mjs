// Pasos de despliegue que comparten `local:up`, `deploy:local`, `deploy:web:local` y `aws:deploy`.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AWS, fail, info, node, ROOT, run, step, terraform, terraformOutputs } from "./lib.mjs";

export function buildLambdas() {
  step("Build de las Lambdas (esbuild)");
  node("services/api/scripts/build.mjs");
}

/** Export estático del frontend en apps/web/out, sin config.json (lo escribe Terraform en cada entorno). */
export function buildWeb() {
  step("Build estático del frontend (next build)");
  const web = join(ROOT, "apps", "web");
  run(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "build"], { cwd: web });
  run(process.execPath, [join("scripts", "postbuild.mjs")], { cwd: web });
}

/** Invoca la Lambda migrator. `client` permite usarla contra Floci (por defecto) o contra AWS. */
export async function invokeMigrator(functionName, client = new LambdaClient(AWS)) {
  const res = await client.send(new InvokeCommand({ FunctionName: functionName }));
  const payload = res.Payload ? new TextDecoder().decode(res.Payload) : "";
  if (res.FunctionError) fail(`El migrator falló: ${payload}`);
  return JSON.parse(payload).applied;
}

export function applyInfra() {
  step("Terraform apply en infra/envs/local (la primera vez tarda ~2 min por RDS)");
  terraform(["init", "-input=false", "-no-color"], { capture: true });
  terraform(["apply", "-auto-approve", "-input=false", "-no-color", "-compact-warnings"]);
  return terraformOutputs();
}

export async function migrate(outputs) {
  step("Migraciones (Lambda migrator)");
  info(`${await invokeMigrator(outputs.migrator_function_name)} migraciones aplicadas`);
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
