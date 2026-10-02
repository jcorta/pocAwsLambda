"use client";
// Carga /config.json antes de montar la app (SPEC §5.2) y provee la sesión y la cache de datos.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Spinner } from "../components/ui.tsx";
import { AuthProvider } from "../lib/auth.tsx";
import { loadRuntimeConfig, type RuntimeConfig } from "../lib/config.ts";

export function Providers({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );

  useEffect(() => {
    loadRuntimeConfig()
      .then(setConfig)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <div role="alert" className="mx-auto mt-16 max-w-lg rounded border border-red-300 bg-red-50 p-4 text-red-800">
        <p className="font-semibold">No se pudo cargar la configuración de la aplicación.</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }
  if (!config) return <Spinner label="Cargando…" />;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider config={config}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
