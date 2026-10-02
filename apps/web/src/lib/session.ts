// Sesión en memoria (decisión D-2.3): los tokens nunca se guardan en localStorage, sessionStorage ni cookies.

export interface Session {
  idToken: string;
  /** Solo para GlobalSignOut (SPEC §5.3). */
  accessToken: string;
  refreshToken: string;
  /** Vencimiento del ID token, en milisegundos epoch. */
  expiresAt: number;
}

/** El ID token se renueva un minuto antes de vencer (SPEC §5.3). */
export const REFRESH_MARGIN_MS = 60_000;

export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - now <= REFRESH_MARGIN_MS;
}

/** Payload de un JWT, sin validar la firma (la valida el JWT authorizer de la API). */
export function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Token inválido");
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    Array.from(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")))
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

export function sessionFromTokens(tokens: { idToken: string; accessToken: string; refreshToken: string }): Session {
  const exp = decodeJwt(tokens.idToken)["exp"];
  if (typeof exp !== "number") throw new Error("El ID token no tiene exp");
  return { ...tokens, expiresAt: exp * 1000 };
}

/** Ruta a la que volver después del login (`?next=`). Solo rutas internas, para no permitir redirecciones abiertas. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/resources/";
}
