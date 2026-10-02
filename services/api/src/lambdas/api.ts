// Fábrica de los entrypoints de las Lambdas de la API: une rutas, dependencias y logger.
// Cada entrypoint importa solo las rutas de su dominio, así su bundle no incluye los demás (SPEC §6.7).
import { Logger } from "@aws-lambda-powertools/logger";
import { createLambdaHandler, type Routes } from "../handlers/router.ts";
import type { ApiLambdaName } from "../handlers/routes/index.ts";
import { lazyServiceDeps } from "../infra/runtime.ts";

export function apiLambda(name: ApiLambdaName, routes: Routes) {
  return createLambdaHandler({
    routes,
    getDeps: lazyServiceDeps(),
    logger: new Logger({ serviceName: `reservas-${name}` }),
    requireAdmin: name === "admin",
  });
}
