"use client";
// Protege una página: sin sesión, redirige a /login con `?next=` a la ruta actual (SPEC §5.3).
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../lib/auth.tsx";
import { Alert, Spinner } from "./ui.tsx";

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { status, isAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      const next = `${pathname}${window.location.search}`;
      router.replace(`/login/?next=${encodeURIComponent(next)}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated") return <Spinner label="Redirigiendo al login…" />;
  if (admin && !isAdmin) return <Alert>Esta sección es solo para administradores.</Alert>;
  return <>{children}</>;
}
