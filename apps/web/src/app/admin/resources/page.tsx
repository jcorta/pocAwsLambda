"use client";
// CU-07: recursos (también los inactivos), con crear, editar y activar o desactivar.
import { ResourceSchema, type ResourceDto } from "@reservas/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { AdminTabs } from "../../../components/admin-tabs.tsx";
import { QueryState } from "../../../components/query-state.tsx";
import { RequireAuth } from "../../../components/require-auth.tsx";
import { Alert, Button } from "../../../components/ui.tsx";
import { useAuth } from "../../../lib/auth.tsx";
import { errorMessage } from "../../../lib/errors.ts";

const ResourceList = z.object({ items: z.array(ResourceSchema) });

export default function AdminResourcesPage() {
  return (
    <RequireAuth admin>
      <AdminTabs />
      <AdminResources />
    </RequireAuth>
  );
}

function AdminResources() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-resources"],
    queryFn: () => api("GET", "/v1/resources", { schema: ResourceList, query: { includeInactive: "true" } }),
  });

  // PUT es un reemplazo completo: se reenvía el recurso con isActive invertido (RN-09)
  const toggle = useMutation({
    mutationFn: (r: ResourceDto) =>
      api("PUT", `/v1/admin/resources/${r.id}`, {
        schema: ResourceSchema,
        body: {
          name: r.name,
          description: r.description,
          attributes: r.attributes,
          slotMinutes: r.slotMinutes,
          openingHours: r.openingHours,
          isActive: !r.isActive,
        },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recursos</h1>
        <Link href="/admin/resources/edit/" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Nuevo recurso
        </Link>
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <QueryState
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
        empty="Todavía no hay recursos. Creá el primero."
      >
        <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Turnos</th>
              <th className="px-4 py-2">Días</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2">{r.slotMinutes} min</td>
                <td className="px-4 py-2">{r.openingHours.length}</td>
                <td className="px-4 py-2">{r.isActive ? "Activo" : "Inactivo"}</td>
                <td className="flex justify-end gap-2 px-4 py-2">
                  <Link
                    href={`/admin/resources/edit/?id=${r.id}`}
                    className="rounded border border-slate-300 px-3 py-1"
                  >
                    Editar
                  </Link>
                  <Button variant="secondary" onClick={() => toggle.mutate(r)} disabled={toggle.isPending}>
                    {r.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>
    </section>
  );
}
