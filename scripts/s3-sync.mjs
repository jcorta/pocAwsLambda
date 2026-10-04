// Publicación del export estático en un bucket S3, compartida por el entorno local (Floci) y AWS.
// Equivale a `aws s3 sync <dir> s3://<bucket> --delete --exclude config.json`, con Content-Type y Cache-Control
// correctos y sin depender de la AWS CLI.
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

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

/** Sube `dir` a `bucket` y borra lo que ya no está en el build. Devuelve cuántos archivos subió y borró. */
export async function syncDir({ s3, bucket: Bucket, dir }) {
  const local = new Map(filesIn(dir).map((f) => [relative(dir, f).split(sep).join("/"), f]));

  let uploaded = 0;
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
    uploaded++;
  }

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
  return { uploaded, deleted: stale.length };
}
