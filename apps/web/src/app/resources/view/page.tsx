"use client";
// CU-03 y CU-04: detalle del recurso, disponibilidad por día y reserva con confirmación.
// Ruta con query param (`?id=`) porque el export estático no admite segmentos dinámicos (SPEC §5.1).
import { AvailabilitySchema, BookingSchema, ResourceSchema, type AvailabilityDto } from "@reservas/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { QueryState } from "../../../components/query-state.tsx";
import { RequireAuth } from "../../../components/require-auth.tsx";
import { SlotGrid } from "../../../components/slot-grid.tsx";
import { Alert, Button, Card, Spinner } from "../../../components/ui.tsx";
import { useAuth } from "../../../lib/auth.tsx";
import { ApiError, errorMessage } from "../../../lib/errors.ts";
import { formatDateTime, localDate, timezoneLabel } from "../../../lib/format.ts";

type Slot = AvailabilityDto["slots"][number];

export default function ResourceViewPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<Spinner />}>
        <ResourceView />
      </Suspense>
    </RequireAuth>
  );
}

function ResourceView() {
  const { api, config } = useAuth();
  const id = useSearchParams().get("id") ?? "";
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => localDate(config.timezone));
  const [selected, setSelected] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const resource = useQuery({
    queryKey: ["resource", id],
    queryFn: () => api("GET", `/v1/resources/${id}`, { schema: ResourceSchema }),
    enabled: Boolean(id),
  });
  const availability = useQuery({
    queryKey: ["availability", id, date],
    queryFn: () => api("GET", `/v1/resources/${id}/availability`, { schema: AvailabilitySchema, query: { date } }),
    enabled: Boolean(id) && Boolean(date),
    retry: false,
  });

  const book = useMutation({
    mutationFn: (slot: Slot) =>
      api("POST", "/v1/bookings", { schema: BookingSchema, body: { resourceId: id, startsAt: slot.startsAt } }),
    onSuccess: (b) => {
      setSelected(null);
      setNotice({ kind: "success", text: `Reserva confirmada: ${formatDateTime(b.startsAt, config.timezone)}.` });
      void queryClient.invalidateQueries({ queryKey: ["availability", id] });
      void queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    },
    onError: (err) => {
      setSelected(null);
      setNotice({ kind: "error", text: errorMessage(err) });
      // Si otro lo reservó primero, se refresca la grilla (SPEC §5.5)
      if (err instanceof ApiError && err.code === "SLOT_TAKEN") {
        void queryClient.invalidateQueries({ queryKey: ["availability", id] });
      }
    },
  });

  const outOfRange =
    availability.error instanceof ApiError && availability.error.code === "DATE_OUT_OF_RANGE"
      ? (availability.error.details as { from?: string; to?: string } | undefined)
      : undefined;

  return (
    <section className="flex flex-col gap-6">
      <Link href="/resources/" className="text-sm text-blue-700 underline">
        ← Volver a recursos
      </Link>
      <QueryState
        isPending={resource.isPending && Boolean(id)}
        error={id ? resource.error : new Error("Falta el recurso")}
        onRetry={() => void resource.refetch()}
      >
        {resource.data && (
          <>
            <header>
              <h1 className="text-2xl font-semibold">{resource.data.name}</h1>
              {resource.data.description && <p className="mt-1 text-slate-600">{resource.data.description}</p>}
              <p className="mt-1 text-sm text-slate-500">Turnos de {resource.data.slotMinutes} minutos</p>
            </header>

            <Card>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="date">
                  Fecha
                  <input
                    id="date"
                    type="date"
                    value={date}
                    min={localDate(config.timezone)}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setNotice(null);
                    }}
                    className="rounded border border-slate-300 px-3 py-2 font-normal"
                  />
                </label>
                <span className="text-sm text-slate-500">Horarios de {timezoneLabel(config.timezone)}</span>
              </div>

              {notice && (
                <div className="mb-4">
                  <Alert kind={notice.kind}>{notice.text}</Alert>
                </div>
              )}

              {outOfRange ? (
                <Alert kind="info">
                  Solo se puede reservar entre el {outOfRange.from} y el {outOfRange.to}.
                </Alert>
              ) : (
                <QueryState
                  isPending={availability.isPending}
                  error={availability.error}
                  onRetry={() => void availability.refetch()}
                >
                  {availability.data && (
                    <SlotGrid slots={availability.data.slots} timezone={config.timezone} onSelect={setSelected} />
                  )}
                </QueryState>
              )}

              {selected && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="confirm-title"
                  className="mt-4 rounded border border-blue-300 bg-blue-50 p-4"
                >
                  <p id="confirm-title" className="font-medium">
                    ¿Reservar {resource.data.name} el {formatDateTime(selected.startsAt, config.timezone)}?
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => book.mutate(selected)} disabled={book.isPending} autoFocus>
                      {book.isPending ? "Reservando…" : "Confirmar reserva"}
                    </Button>
                    <Button variant="secondary" onClick={() => setSelected(null)} disabled={book.isPending}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </QueryState>
    </section>
  );
}
