// Frontend Next.js (SPEC §5). Por ahora es un esqueleto que verifica el enlace con @reservas/shared; Next.js llega en F5.
import { API_VERSION } from "@reservas/shared";

export const apiPath = (path: string) => `/${API_VERSION}${path}`;
