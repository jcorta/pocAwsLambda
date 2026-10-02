// Next.js como sitio estático (SPEC §5.1): sin servidor, se sirve desde S3.
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  // /resources/ → resources/index.html: así lo sirve el website hosting de S3 sin reglas de reescritura
  trailingSlash: true,
  // Sin servidor no hay optimización de imágenes
  images: { unoptimized: true },
  // @reservas/shared se consume como TypeScript fuente
  transpilePackages: ["@reservas/shared"],
};

export default config;
