// Entrypoint de la Lambda `me` (SPEC §6.7).
import { meRoutes } from "../handlers/routes/me.ts";
import { apiLambda } from "./api.ts";

export const handler = apiLambda("me", meRoutes);
