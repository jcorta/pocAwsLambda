"use client";
// Estados de una consulta (SPEC §5.5): carga, error con opción de reintentar, y vacío.
import type { ReactNode } from "react";
import { errorMessage } from "../lib/errors.ts";
import { Alert, Button, Spinner } from "./ui.tsx";

export function QueryState({
  isPending,
  error,
  onRetry,
  isEmpty = false,
  empty = "No hay nada para mostrar.",
  children,
}: {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (isPending) return <Spinner />;
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert>{errorMessage(error)}</Alert>
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (isEmpty) return <p className="py-8 text-center text-slate-500">{empty}</p>;
  return <>{children}</>;
}
