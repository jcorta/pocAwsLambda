import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlotGrid, slotLabel } from "./slot-grid.tsx";

afterEach(cleanup);

const BA = "America/Argentina/Buenos_Aires";
const slot = (hour: number, status: "available" | "booked" | "past", mine = false) => ({
  startsAt: `2026-10-05T${String(hour).padStart(2, "0")}:00:00-03:00`,
  endsAt: `2026-10-05T${String(hour + 1).padStart(2, "0")}:00:00-03:00`,
  status,
  mine,
});

describe("SlotGrid (CU-03)", () => {
  it("solo los turnos disponibles se pueden elegir", () => {
    const onSelect = vi.fn();
    render(
      <SlotGrid
        slots={[slot(8, "past"), slot(9, "booked"), slot(10, "booked", true), slot(11, "available")]}
        timezone={BA}
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([true, true, true, false]);
    fireEvent.click(buttons[3]!);
    expect(onSelect).toHaveBeenCalledWith(slot(11, "available"));
  });

  it("cada turno tiene un nombre accesible con horario y estado", () => {
    render(<SlotGrid slots={[slot(10, "booked", true)]} timezone={BA} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "10:00 a 11:00: Tu reserva" })).toBeTruthy();
  });

  it("avisa cuando el día no tiene turnos", () => {
    render(<SlotGrid slots={[]} timezone={BA} onSelect={() => {}} />);
    expect(screen.getByText("El recurso no tiene turnos ese día.")).toBeTruthy();
  });

  it("etiquetas de estado", () => {
    expect(slotLabel(slot(8, "available"))).toBe("Disponible");
    expect(slotLabel(slot(8, "booked"))).toBe("Ocupado");
    expect(slotLabel(slot(8, "past", true))).toBe("Tu reserva (pasada)");
  });
});
