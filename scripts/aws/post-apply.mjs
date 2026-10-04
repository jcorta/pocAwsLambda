#!/usr/bin/env node
// `node scripts/aws/post-apply.mjs <outputs.json>`: pasos después del `terraform apply` en deploy-aws.yml
// (SPEC §9.2): migraciones y publicación del sitio, igual que `pnpm aws:deploy`. Usa las credenciales del
// entorno (OIDC en la CI) y espera el build del sitio en apps/web/out.
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invokeMigrator } from "../local/deploy-steps.mjs";
import { fail, info, ROOT, step } from "../local/lib.mjs";
import { syncDir } from "../s3-sync.mjs";

const file = process.argv[2];
if (!file) fail("Uso: node scripts/aws/post-apply.mjs <outputs.json>");
const out = Object.fromEntries(Object.entries(JSON.parse(readFileSync(file, "utf8"))).map(([k, v]) => [k, v.value]));
const region = process.env["AWS_REGION"] ?? "us-east-1";

step("Migraciones (Lambda migrator)");
info(`${await invokeMigrator(out.migrator_function_name, new LambdaClient({ region }))} migraciones aplicadas`);

// config.json lo escribe Terraform: el sync no lo toca (SPEC §5.2). Sin invalidar CloudFront: el HTML y
// config.json no se cachean, y los assets llevan hash en el nombre
step(`Publicando el sitio en s3://${out.frontend_bucket}`);
const { uploaded, deleted } = await syncDir({
  s3: new S3Client({ region }),
  bucket: out.frontend_bucket,
  dir: join(ROOT, "apps", "web", "out"),
});
info(`${uploaded} archivos subidos${deleted ? `, ${deleted} viejos borrados` : ""}`);
