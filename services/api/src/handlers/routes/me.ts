// Lambda `me` (SPEC §6.7): GET /v1/me.
import type { MeDto } from "@reservas/shared";
import { registerUser } from "../../services/users.ts";
import { json } from "../http.ts";
import type { Routes } from "../router.ts";

export const meRoutes: Routes = {
  "GET /v1/me": async ({ actor, deps, requestId }) => {
    await registerUser(deps, actor);
    const body: MeDto = { id: actor.userId, email: actor.email, roles: [actor.isAdmin ? "admin" : "user"] };
    return json(200, body, requestId);
  },
};
