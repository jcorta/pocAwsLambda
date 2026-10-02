// Cliente HTTP tipado de la API (SPEC §5.1): valida cada respuesta con los esquemas de @reservas/shared.
import { ErrorResponseSchema } from "@reservas/shared";
import type { z } from "zod";
import { ApiError } from "./errors.ts";

export interface ApiClientOptions {
  baseUrl: string;
  /** ID token vigente (lo renueva si está por vencer), o null si no hay sesión. */
  getIdToken: () => Promise<string | null>;
  /** Fuerza un refresh. Devuelve false si no se pudo (refresh token vencido o revocado). */
  forceRefresh: () => Promise<boolean>;
  /** Se llama cuando la sesión ya no sirve: la app redirige a /login (SPEC §5.3). */
  onSessionExpired: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<S extends z.ZodType> {
  body?: unknown;
  schema: S;
  query?: Record<string, string | undefined>;
}

export type ApiClient = <S extends z.ZodType>(
  method: "GET" | "POST" | "PUT",
  path: string,
  opts: RequestOptions<S>,
) => Promise<z.infer<S>>;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function send(method: string, url: string, body: unknown, token: string | null): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "Sin conexión con la API");
    }
  }

  return async (method, path, { body, schema, query }) => {
    const qs = new URLSearchParams(
      Object.entries(query ?? {}).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""),
    ).toString();
    const url = `${options.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    let res = await send(method, url, body, await options.getIdToken());
    // Ante un 401, un único intento de refresh y reintento (SPEC §5.3)
    if (res.status === 401 && (await options.forceRefresh())) {
      res = await send(method, url, body, await options.getIdToken());
    }
    if (res.status === 401) {
      options.onSessionExpired();
      throw new ApiError(401, "UNAUTHORIZED", "Sesión vencida");
    }

    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ErrorResponseSchema.safeParse(json);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiError(res.status, code, message, details);
      }
      throw new ApiError(res.status, "INTERNAL_ERROR", `HTTP ${res.status}`);
    }
    return schema.parse(json);
  };
}
