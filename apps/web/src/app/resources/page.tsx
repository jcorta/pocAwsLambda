"use client";
// CU-02: recursos activos con nombre, descripción, atributos y duración de turno.
import { ResourceSchema } from "@reservas/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { QueryState } from "../../components/query-state.tsx";
import { RequireAuth } from "../../components/require-auth.tsx";
import { Card } from "../../components/ui.tsx";
import { useAuth } from "../../lib/auth.tsx";

const ResourceList = z.object({ items: z.array(ResourceSchema) });

export default function ResourcesPage() {
  return (
    <RequireAuth>
      <Resources />
    </RequireAuth>
  );
}

function Resources() {
  const { api } = useAuth();
  const q = useQuery({ queryKey: ["resources"], queryFn: () => api("GET", "/v1/resources", { schema: ResourceList }) });

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Recursos</h1>
      <QueryState
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
        empty="Todavía no hay recursos disponibles."
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {q.data?.items.map((r) => (
            <li key={r.id}>
              <Card className="h-full">
                <h2 className="text-lg font-semibold">
                  <Link href={`/resources/view/?id=${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </h2>
                {r.description && <p className="mt-1 text-sm text-slate-600">{r.description}</p>}
                <p className="mt-3 text-sm">Turnos de {r.slotMinutes} minutos</p>
                {Object.keys(r.attributes).length > 0 && (
                  <dl className="mt-2 flex flex-wrap gap-2 text-xs">
                    {Object.entries(r.attributes).map(([k, v]) => (
                      <div key={k} className="rounded bg-slate-100 px-2 py-1">
                        <dt className="inline font-medium">{k}:</dt> <dd className="inline">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <Link
                  href={`/resources/view/?id=${r.id}`}
                  className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
                >
                  Ver disponibilidad
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </QueryState>
    </section>
  );
}
