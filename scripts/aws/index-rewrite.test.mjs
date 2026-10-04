// Tests de la CloudFront Function que resuelve los índices del export estático (infra/modules/frontend).
// Se evalúa el mismo archivo que publica Terraform. Se corren con `node --test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "infra",
  "modules",
  "frontend",
  "index-rewrite.js",
);
const context = vm.createContext({});
vm.runInContext(readFileSync(file, "utf8"), context);
const rewrite = (uri) => context.handler({ request: { uri } }).uri;

test("una ruta con barra final apunta a su index.html", () => {
  assert.equal(rewrite("/"), "/index.html");
  assert.equal(rewrite("/resources/"), "/resources/index.html");
  assert.equal(rewrite("/admin/resources/edit/"), "/admin/resources/edit/index.html");
});

test("una ruta sin extensión es una página: se le agrega /index.html", () => {
  assert.equal(rewrite("/bookings"), "/bookings/index.html");
  assert.equal(rewrite("/resources/view"), "/resources/view/index.html");
});

test("los archivos quedan igual", () => {
  assert.equal(rewrite("/config.json"), "/config.json");
  assert.equal(rewrite("/_next/static/chunks/app-1a2b.js"), "/_next/static/chunks/app-1a2b.js");
  assert.equal(rewrite("/404.html"), "/404.html");
});

test("un punto en una carpeta no confunde una página con un archivo", () => {
  assert.equal(rewrite("/v1.2/docs"), "/v1.2/docs/index.html");
});
