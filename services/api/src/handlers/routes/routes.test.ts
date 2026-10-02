// Consistencia entre las rutas que declara Terraform y las que atiende el código (SPEC §6.7).
// Si alguien agrega una ruta en un lado y no en el otro, este test falla.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAMBDA_ROUTES } from "./index.ts";

const ROUTES_TF = join(dirname(fileURLToPath(import.meta.url)), "../../../../../infra/modules/api/routes.tf.json");
const terraformRoutes = (JSON.parse(readFileSync(ROUTES_TF, "utf8")) as { locals: { routes: Record<string, string> } })
  .locals.routes;

const codeRoutes = Object.fromEntries(
  Object.entries(LAMBDA_ROUTES).flatMap(([lambda, routes]) => Object.keys(routes).map((key) => [key, lambda])),
);

describe("rutas de Terraform vs. handlers", () => {
  it("cada ruta de Terraform tiene su handler en la Lambda correcta, y viceversa", () => {
    expect(terraformRoutes).toEqual(codeRoutes);
  });

  it("son las 12 rutas de SPEC §4.5", () => expect(Object.keys(terraformRoutes)).toHaveLength(12));

  it("no hay rutas comodín ({proxy+})", () =>
    expect(Object.keys(terraformRoutes).filter((r) => r.includes("proxy+"))).toEqual([]));

  it("todas las rutas cuelgan de /v1", () =>
    expect(Object.keys(terraformRoutes).every((r) => / \/v1\//.test(r))).toBe(true));
});
