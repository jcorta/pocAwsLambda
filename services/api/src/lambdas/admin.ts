// Entrypoint de la Lambda `admin` (SPEC §6.7). Valida el grupo admin antes de rutear.
import { adminRoutes } from "../handlers/routes/admin.ts";
import { apiLambda } from "./api.ts";

export const handler = apiLambda("admin", adminRoutes);
