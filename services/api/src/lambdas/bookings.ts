// Entrypoint de la Lambda `bookings` (SPEC §6.7).
import { bookingsRoutes } from "../handlers/routes/bookings.ts";
import { apiLambda } from "./api.ts";

export const handler = apiLambda("bookings", bookingsRoutes);
