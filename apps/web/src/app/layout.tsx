import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "../components/nav.tsx";
import "./globals.css";
import { Providers } from "./providers.tsx";

export const metadata: Metadata = {
  title: "Reservas",
  description: "Reserva de recursos compartidos por turnos",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
