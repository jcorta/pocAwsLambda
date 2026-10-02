"use client";
// CU-05 y CU-06: mis reservas en pestañas "Próximas" y "Pasadas", con cancelación.
import { useState } from "react";
import { BookingList } from "../../components/booking-list.tsx";
import { RequireAuth } from "../../components/require-auth.tsx";

const TABS = [
  { scope: "upcoming", label: "Próximas", empty: "No tenés reservas próximas." },
  { scope: "past", label: "Pasadas", empty: "Todavía no tenés reservas pasadas ni canceladas." },
] as const;

export default function BookingsPage() {
  return (
    <RequireAuth>
      <MyBookings />
    </RequireAuth>
  );
}

function MyBookings() {
  const [scope, setScope] = useState<(typeof TABS)[number]["scope"]>("upcoming");
  const tab = TABS.find((t) => t.scope === scope)!;
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Mis reservas</h1>
      <div role="tablist" aria-label="Mis reservas" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.scope}
            role="tab"
            type="button"
            aria-selected={t.scope === scope}
            onClick={() => setScope(t.scope)}
            className={`rounded px-4 py-2 text-sm ${t.scope === scope ? "bg-slate-800 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <BookingList queryKey={["my-bookings"]} path="/v1/bookings/me" query={{ scope }} emptyText={tab.empty} />
      </div>
    </section>
  );
}
