#!/usr/bin/env node
// `pnpm deploy:web:local`: build estático del frontend y sincronización con el bucket de Floci (SPEC §10.1).
// Equivale a `aws s3 sync out/ s3://<bucket> --delete --exclude config.json`, sin depender de la AWS CLI.
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { AWS, fail, FLOCI_URL, info, ROOT, run, step, terraformOutputs } from "./lib.mjs";

const WEB = join(ROOT, "apps", "web");
const OUT = join(WEB, "out");
// config.json lo escribe Terraform: nunca se pisa ni se borra (SPEC §5.2)
const PROTECTED = new Set(["config.json"]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)],
  );
}

try {
  await fetch(`${FLOCI_URL}/_floci/health`, { signal: AbortSignal.timeout(2_000) });
} catch {
  fail("Floci no está levantado. Ejecutar primero: pnpm local:up");
}

step("Build estático del frontend (next build)");
run(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: WEB,
});
run(process.execPath, [join("scripts", "postbuild.mjs")], { cwd: WEB });

const outputs = terraformOutputs();
const Bucket = outputs.frontend_bucket;
if (!Bucket) fail("Falta el output frontend_bucket: ¿se aplicó el módulo frontend? Ejecutar pnpm local:up");

step(`Sincronizando apps/web/out con s3://${Bucket}`);
const s3 = new S3Client({ ...AWS, forcePathStyle: true });
const local = new Map(filesIn(OUT).map((f) => [relative(OUT, f).split(sep).join("/"), f]));

for (const [Key, file] of local) {
  if (PROTECTED.has(Key)) continue;
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body: readFileSync(file),
      ContentType: CONTENT_TYPES[extname(Key)] ?? "application/octet-stream",
      // Los assets de Next llevan hash en el nombre; el HTML tiene que revalidarse siempre
      CacheControl: Key.startsWith("_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
    }),
  );
}
info(`${local.size} archivos subidos`);

// --delete: borra lo que ya no está en el build (salvo config.json)
const stale = [];
let ContinuationToken;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken }));
  for (const o of page.Contents ?? []) if (o.Key && !local.has(o.Key) && !PROTECTED.has(o.Key)) stale.push(o.Key);
  ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (ContinuationToken);
for (let i = 0; i < stale.length; i += 1000) {
  await s3.send(
    new DeleteObjectsCommand({ Bucket, Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })) } }),
  );
}
if (stale.length) info(`${stale.length} archivos viejos borrados`);

console.log(`\n✔ Sitio publicado en ${outputs.frontend_url}`);
