// Configuración de runtime (SPEC §5.2): el mismo build sirve para Floci y para AWS.
// /config.json lo escribe Terraform en el bucket (o `local:up` para `pnpm dev`).
import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  apiUrl: z.url(),
  cognito: z.object({
    region: z.string(),
    userPoolId: z.string(),
    clientId: z.string(),
    // Solo en Floci; en AWS se omite y el SDK usa el endpoint de AWS. Puede ser una ruta del mismo origen
    // ("/_floci/cognito"), que atiende el proxy local porque Cognito de Floci no soporta CORS (hallazgo A8)
    endpoint: z
      .string()
      // `URL.canParse` solo no alcanza: "localhost:4566" parsea como una URL con el esquema "localhost:"
      .refine(
        (v) => v.startsWith("/") || (/^https?:\/\//.test(v) && URL.canParse(v)),
        "Tiene que ser una URL http(s) o una ruta que empiece con /",
      )
      .optional(),
  }),
  timezone: z.string(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/** Endpoint absoluto de Cognito: una ruta relativa se resuelve contra el origen de la página. */
export function cognitoEndpoint(config: RuntimeConfig, origin: string): string | undefined {
  const endpoint = config.cognito.endpoint;
  return endpoint?.startsWith("/") ? new URL(endpoint, origin).toString().replace(/\/$/, "") : endpoint;
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const res = await fetchImpl("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar /config.json (HTTP ${res.status})`);
  return RuntimeConfigSchema.parse(await res.json());
}
