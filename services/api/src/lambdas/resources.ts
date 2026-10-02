// Entrypoint de la Lambda `resources` (SPEC §6.7).
import { resourcesRoutes } from "../handlers/routes/resources.ts";
import { apiLambda } from "./api.ts";

export const handler = apiLambda("resources", resourcesRoutes);
