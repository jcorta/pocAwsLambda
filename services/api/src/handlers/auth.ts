// Identidad a partir de los claims que valida el JWT authorizer (SPEC §6.2).
import { reject, type RuleFailure } from "../domain/types.ts";
import type { Actor } from "../services/context.ts";
import type { HttpEvent } from "./http.ts";

/**
 * `cognito:groups` llega a la Lambda como string "[admin]" o "[admin user]" (verificado en el spike F0),
 * aunque en el token sea un array. Se aceptan las dos formas, y también un JSON array.
 */
export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  const value = raw.trim();
  if (value.startsWith("[") && value.includes('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // no era JSON: sigue con el formato "[a b]"
    }
  }
  return value
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * El authorizer también deja pasar el access token (hallazgo A3 del spike F0), que no trae `email`.
 * Por eso se exige `token_use = id`.
 */
export function actorFromEvent(event: HttpEvent): Actor | RuleFailure {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = claims["sub"];
  const email = claims["email"];
  if (claims["token_use"] !== "id" || typeof sub !== "string" || typeof email !== "string") {
    return reject("INVALID_TOKEN_TYPE");
  }
  return { userId: sub, email, isAdmin: parseGroups(claims["cognito:groups"]).includes("admin") };
}
