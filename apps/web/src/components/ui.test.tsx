import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Alert, Field } from "./ui.tsx";

afterEach(cleanup);

describe("Field (accesibilidad básica, SPEC §5.5)", () => {
  it("asocia el label al input", () => {
    render(<Field id="email" label="Email" />);
    expect(screen.getByLabelText("Email").getAttribute("id")).toBe("email");
  });

  it("marca el error con aria-invalid y lo vincula con aria-describedby", () => {
    render(<Field id="name" label="Nombre" error="Requerido" />);
    const input = screen.getByLabelText("Nombre");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Requerido");
  });
});

describe("Alert", () => {
  it("los errores usan role=alert para que los lectores de pantalla los anuncien", () => {
    render(<Alert>Algo salió mal</Alert>);
    expect(screen.getByRole("alert").textContent).toBe("Algo salió mal");
  });
});
