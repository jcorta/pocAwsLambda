"use client";
// CU-07: crear (sin `id`) o editar (con `?id=`) un recurso, con la grilla de horario semanal.
import { ResourceSchema, SLOT_MINUTES, type ResourceDto } from "@reservas/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AdminTabs } from "../../../../components/admin-tabs.tsx";
import { QueryState } from "../../../../components/query-state.tsx";
import { RequireAuth } from "../../../../components/require-auth.tsx";
import { Alert, Button, Card, Field, Spinner } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth.tsx";
import { ApiError, errorMessage } from "../../../../lib/errors.ts";
import {
  openingHoursFromRows,
  rowErrors,
  rowsFromOpeningHours,
  WEEKDAYS,
  type DayRow,
} from "../../../../lib/schedule.ts";

export default function EditResourcePage() {
  return (
    <RequireAuth admin>
      <AdminTabs />
      <Suspense fallback={<Spinner />}>
        <EditResource />
      </Suspense>
    </RequireAuth>
  );
}

function EditResource() {
  const { api } = useAuth();
  const id = useSearchParams().get("id");
  const existing = useQuery({
    queryKey: ["resource", id],
    queryFn: () => api("GET", `/v1/resources/${id}`, { schema: ResourceSchema }),
    enabled: Boolean(id),
  });

  if (id) {
    return (
      <QueryState isPending={existing.isPending} error={existing.error} onRetry={() => void existing.refetch()}>
        {existing.data && <ResourceForm initial={existing.data} />}
      </QueryState>
    );
  }
  return <ResourceForm />;
}

function ResourceForm({ initial }: { initial?: ResourceDto }) {
  const { api } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [attributes, setAttributes] = useState(JSON.stringify(initial?.attributes ?? {}, null, 2));
  const [slotMinutes, setSlotMinutes] = useState(initial?.slotMinutes ?? 60);
  const [rows, setRows] = useState<DayRow[]>(() => rowsFromOpeningHours(initial?.openingHours ?? []));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setFieldErrors({}), [name, slotMinutes, rows]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial
        ? api("PUT", `/v1/admin/resources/${initial.id}`, {
            schema: ResourceSchema,
            body: { ...body, isActive: initial.isActive ?? true },
          })
        : api("POST", "/v1/admin/resources", { schema: ResourceSchema, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
      void queryClient.invalidateQueries({ queryKey: ["resources"] });
      if (initial) void queryClient.invalidateQueries({ queryKey: ["resource", initial.id] });
      router.push("/admin/resources/");
    },
    onError: (err) => {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") setFieldErrors(err.fieldErrors);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let parsedAttributes: unknown;
    try {
      parsedAttributes = JSON.parse(attributes || "{}");
      if (typeof parsedAttributes !== "object" || parsedAttributes === null || Array.isArray(parsedAttributes)) {
        throw new Error();
      }
    } catch {
      setFieldErrors({ attributes: 'Tiene que ser un objeto JSON, por ejemplo {"capacidad": 8}' });
      return;
    }
    save.mutate({
      name,
      description: description || null,
      attributes: parsedAttributes,
      slotMinutes,
      openingHours: openingHoursFromRows(rows),
    });
  }

  const dayErrors = rowErrors(rows, fieldErrors);
  const setRow = (weekday: number, patch: Partial<DayRow>) =>
    setRows((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));

  return (
    <Card>
      <h1 className="mb-6 text-2xl font-semibold">{initial ? `Editar ${initial.name}` : "Nuevo recurso"}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field
          id="name"
          label="Nombre"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors["name"]}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-slate-700">
            Descripción
          </label>
          <textarea
            id="description"
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="attributes" className="text-sm font-medium text-slate-700">
            Atributos (JSON)
          </label>
          <textarea
            id="attributes"
            value={attributes}
            onChange={(e) => setAttributes(e.target.value)}
            aria-invalid={fieldErrors["attributes"] ? true : undefined}
            aria-describedby={fieldErrors["attributes"] ? "attributes-error" : undefined}
            className="rounded border border-slate-300 px-3 py-2 font-mono text-sm"
            rows={3}
          />
          {fieldErrors["attributes"] && (
            <p id="attributes-error" className="text-sm text-red-700">
              {fieldErrors["attributes"]}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="slotMinutes" className="text-sm font-medium text-slate-700">
            Duración del turno
          </label>
          <select
            id="slotMinutes"
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value))}
            className="w-40 rounded border border-slate-300 px-3 py-2"
          >
            {SLOT_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} minutos
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-slate-700">Horario semanal</legend>
          {WEEKDAYS.map(({ weekday, label }) => {
            const row = rows.find((r) => r.weekday === weekday)!;
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.open}
                    onChange={(e) => setRow(weekday, { open: e.target.checked })}
                  />
                  {label}
                </label>
                <input
                  type="time"
                  aria-label={`${label}: apertura`}
                  value={row.opensAt}
                  disabled={!row.open}
                  onChange={(e) => setRow(weekday, { opensAt: e.target.value })}
                  className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                />
                <span className="text-sm text-slate-500">a</span>
                <input
                  type="time"
                  aria-label={`${label}: cierre`}
                  value={row.closesAt}
                  disabled={!row.open}
                  onChange={(e) => setRow(weekday, { closesAt: e.target.value })}
                  className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
                />
                {dayErrors[weekday] && <span className="text-sm text-red-700">{dayErrors[weekday]}</span>}
              </div>
            );
          })}
        </fieldset>

        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/admin/resources/")}>
            Volver
          </Button>
        </div>
      </form>
    </Card>
  );
}
