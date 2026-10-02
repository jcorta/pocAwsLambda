"use client";
// Grilla de turnos de un día (CU-03): disponible, ocupado, mío o pasado. Navegable con teclado.
import type { AvailabilityDto } from "@reservas/shared";
import { formatTime } from "../lib/format.ts";

type Slot = AvailabilityDto["slots"][number];

const LABELS = { available: "Disponible", booked: "Ocupado", past: "Pasado" } as const;

export function slotLabel(slot: Slot): string {
  if (slot.mine && slot.status !== "available") return slot.status === "past" ? "Tu reserva (pasada)" : "Tu reserva";
  return LABELS[slot.status];
}

export function SlotGrid({
  slots,
  timezone,
  onSelect,
}: {
  slots: Slot[];
  timezone: string;
  onSelect: (slot: Slot) => void;
}) {
  if (slots.length === 0) {
    return <p className="py-6 text-center text-slate-500">El recurso no tiene turnos ese día.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Turnos del día">
      {slots.map((slot) => {
        const available = slot.status === "available";
        const style = slot.mine
          ? "border-blue-400 bg-blue-50 text-blue-900"
          : available
            ? "border-green-300 bg-white hover:bg-green-50"
            : "border-slate-200 bg-slate-100 text-slate-400";
        return (
          <li key={slot.startsAt}>
            <button
              type="button"
              disabled={!available}
              onClick={() => onSelect(slot)}
              aria-label={`${formatTime(slot.startsAt, timezone)} a ${formatTime(slot.endsAt, timezone)}: ${slotLabel(slot)}`}
              className={`w-full rounded border px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${style}`}
            >
              <span className="block font-medium">
                {formatTime(slot.startsAt, timezone)}–{formatTime(slot.endsAt, timezone)}
              </span>
              <span className="text-xs">{slotLabel(slot)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
