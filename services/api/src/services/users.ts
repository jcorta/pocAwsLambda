// CU-01 (lado API): registra el usuario en el espejo de Cognito al llamar a GET /v1/me después del login.
import { upsertUser } from "../repositories/users.ts";
import type { Actor, ServiceDeps } from "./context.ts";

export async function registerUser(deps: ServiceDeps, actor: Actor): Promise<void> {
  await upsertUser(deps.db, { id: actor.userId, email: actor.email });
}
