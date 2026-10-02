"use client";
// CU-09: las tres reglas configurables. Aplican a las operaciones siguientes, no a las reservas existentes.
import { SettingsSchema, type SettingsDto } from "@reservas/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AdminTabs } from "../../../components/admin-tabs.tsx";
import { QueryState } from "../../../components/query-state.tsx";
import { RequireAuth } from "../../../components/require-auth.tsx";
import { Alert, Button, Card, Field } from "../../../components/ui.tsx";
import { useAuth } from "../../../lib/auth.tsx";
import { ApiError, errorMessage } from "../../../lib/errors.ts";

export default function AdminSettingsPage() {
  return (
    <RequireAuth admin>
      <AdminTabs />
      <AdminSettings />
    </RequireAuth>
  );
}

function AdminSettings() {
  const { api } = useAuth();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("GET", "/v1/admin/settings", { schema: SettingsSchema }),
  });
  return (
    <QueryState isPending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
      {q.data && <SettingsForm initial={q.data} />}
    </QueryState>
  );
}

function SettingsForm({ initial }: { initial: SettingsDto }) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    maxActiveBookingsPerUser: String(initial.maxActiveBookingsPerUser),
    cancellationMinHours: String(initial.cancellationMinHours),
    bookingHorizonDays: String(initial.bookingHorizonDays),
  });
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      api("PUT", "/v1/admin/settings", {
        schema: SettingsSchema,
        body: {
          maxActiveBookingsPerUser: Number(values.maxActiveBookingsPerUser),
          cancellationMinHours: Number(values.cancellationMinHours),
          bookingHorizonDays: Number(values.bookingHorizonDays),
        },
      }),
    onSuccess: (s) => {
      setFieldErrors({});
      setNotice({ kind: "success", text: "Configuración guardada." });
      queryClient.setQueryData(["settings"], s);
    },
    onError: (err) => {
      setNotice({ kind: "error", text: errorMessage(err) });
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
    },
  });

  const field = (key: keyof typeof values, label: string, min: number) => (
    <Field
      id={key}
      label={label}
      type="number"
      min={min}
      step={1}
      required
      value={values[key]}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      error={fieldErrors[key]}
    />
  );

  return (
    <Card className="max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">Configuración</h1>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {field("maxActiveBookingsPerUser", "Máximo de reservas activas por usuario", 1)}
        {field("cancellationMinHours", "Anticipación mínima para cancelar (horas)", 0)}
        {field("bookingHorizonDays", "Horizonte de reserva (días)", 1)}
        <p className="text-xs text-slate-500">
          Los cambios aplican a las próximas operaciones; las reservas existentes no cambian.
        </p>
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </form>
    </Card>
  );
}
