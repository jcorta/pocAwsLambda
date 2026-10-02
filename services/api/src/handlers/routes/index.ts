// Rutas de cada Lambda (SPEC §6.7). Terraform declara exactamente estas rutas (test de consistencia en F3).
import type { Routes } from "../router.ts";
import { adminRoutes } from "./admin.ts";
import { bookingsRoutes } from "./bookings.ts";
import { meRoutes } from "./me.ts";
import { resourcesRoutes } from "./resources.ts";

export const LAMBDA_ROUTES = {
  me: meRoutes,
  resources: resourcesRoutes,
  bookings: bookingsRoutes,
  admin: adminRoutes,
} as const satisfies Record<string, Routes>;

export type ApiLambdaName = keyof typeof LAMBDA_ROUTES;
