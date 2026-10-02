"use client";
// Lista paginada de reservas con acción de cancelar. La usan "Mis reservas" (CU-05) y el admin (CU-08).
import { BookingSchema, paginated, type BookingDto } from "@reservas/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../lib/auth.tsx";
import { errorMessage } from "../lib/errors.ts";
import { formatDateTime, formatTime } from "../lib/format.ts";
import { QueryState } from "./query-state.tsx";
import { Alert, Button } from "./ui.tsx";

const BookingPage = paginated(BookingSchema);

export function BookingList({
  queryKey,
  path,
  query,
  showOwner = false,
  emptyText,
}: {
  queryKey: unknown[];
  path: string;
  query: Record<string, string | undefined>;
  showOwner?: boolean;
  emptyText: string;
}) {
  const { api, config } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const q = useInfiniteQuery({
    queryKey: [...queryKey, query],
    queryFn: ({ pageParam }) =>
      api("GET", path, { schema: BookingPage, query: { ...query, ...(pageParam ? { cursor: pageParam } : {}) } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const cancel = useMutation({
    mutationFn: (b: BookingDto) => api("POST", `/v1/bookings/${b.id}/cancel`, { schema: BookingSchema }),
    onSuccess: () => {
      setNotice({ kind: "success", text: "Reserva cancelada." });
      void queryClient.invalidateQueries({ queryKey: [queryKey[0]] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
    onError: (err) => setNotice({ kind: "error", text: errorMessage(err) }),
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <QueryState
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={items.length === 0}
        empty={emptyText}
      >
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((b) => {
            const started = new Date(b.startsAt).getTime() <= now;
            const cancellable = b.status === "confirmed" && !started;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{b.resource.name}</p>
                  <p className="text-sm text-slate-600">
                    {formatDateTime(b.startsAt, config.timezone)}–{formatTime(b.endsAt, config.timezone)}
                  </p>
                  {showOwner && b.user && <p className="text-xs text-slate-500">{b.user.email}</p>}
                </div>
                <StatusBadge booking={b} started={started} />
                {cancellable && (
                  <Button
                    variant="secondary"
                    onClick={() => cancel.mutate(b)}
                    disabled={cancel.isPending}
                    aria-label={`Cancelar la reserva de ${b.resource.name} del ${formatDateTime(b.startsAt, config.timezone)}`}
                  >
                    Cancelar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {q.hasNextPage && (
          <Button variant="secondary" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        )}
      </QueryState>
    </div>
  );
}

function StatusBadge({ booking, started }: { booking: BookingDto; started: boolean }) {
  if (booking.status === "cancelled") {
    const by = booking.cancelledBy === "admin" ? " por un administrador" : "";
    return <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Cancelada{by}</span>;
  }
  return started ? (
    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Realizada</span>
  ) : (
    <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800">Confirmada</span>
  );
}
