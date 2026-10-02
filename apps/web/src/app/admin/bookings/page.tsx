"use client";
// CU-08: todas las reservas, filtrables por recurso, fechas, estado y email, con acción de cancelar.
import { ResourceSchema } from "@reservas/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { AdminTabs } from "../../../components/admin-tabs.tsx";
import { BookingList } from "../../../components/booking-list.tsx";
import { RequireAuth } from "../../../components/require-auth.tsx";
import { Button } from "../../../components/ui.tsx";
import { useAuth } from "../../../lib/auth.tsx";

const ResourceList = z.object({ items: z.array(ResourceSchema) });

interface Filters {
  resourceId: string;
  from: string;
  to: string;
  status: string;
  userEmail: string;
}

const EMPTY: Filters = { resourceId: "", from: "", to: "", status: "", userEmail: "" };

export default function AdminBookingsPage() {
  return (
    <RequireAuth admin>
      <AdminTabs />
      <AdminBookings />
    </RequireAuth>
  );
}

function AdminBookings() {
  const { api } = useAuth();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const resources = useQuery({
    queryKey: ["admin-resources"],
    queryFn: () => api("GET", "/v1/resources", { schema: ResourceList, query: { includeInactive: "true" } }),
  });

  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setApplied(draft);
  };
  const input = "rounded border border-slate-300 px-3 py-2 text-sm";

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Reservas</h1>
      <form onSubmit={onSubmit} className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Filtros">
        <label className="flex flex-col gap-1 text-sm">
          Recurso
          <select value={draft.resourceId} onChange={set("resourceId")} className={input}>
            <option value="">Todos</option>
            {resources.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input type="date" value={draft.from} onChange={set("from")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input type="date" value={draft.to} onChange={set("to")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Estado
          <select value={draft.status} onChange={set("status")} className={input}>
            <option value="">Todos</option>
            <option value="confirmed">Confirmadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email del titular
          <input type="email" value={draft.userEmail} onChange={set("userEmail")} className={input} />
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Filtrar</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
            }}
          >
            Limpiar
          </Button>
        </div>
      </form>
      <BookingList
        queryKey={["admin-bookings"]}
        path="/v1/admin/bookings"
        query={{ ...applied }}
        showOwner
        emptyText="No hay reservas con esos filtros."
      />
    </section>
  );
}
