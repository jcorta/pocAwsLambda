// Configuración de runtime (SPEC §5.2): el mismo build sirve para Floci y para AWS.
// /config.json lo escribe Terraform en el bucket (o `local:up` para `pnpm dev`).
import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  apiUrl: z.url(),
  cognito: z.object({
    region: z.string(),
    userPoolId: z.string(),
    clientId: z.string(),
    // Solo en Floci; en AWS se omite y el SDK usa el endpoint de AWS
    endpoint: z.url().optional(),
  }),
  timezone: z.string(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const res = await fetchImpl("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar /config.json (HTTP ${res.status})`);
  return RuntimeConfigSchema.parse(await res.json());
}
