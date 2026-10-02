// Recorridos clave de SPEC §8.2 (E2E UI), en un navegador real contra el sitio en el S3 de Floci.
import { expect, test } from "@playwright/test";
import "./diagnostics.ts";
import { createResource, createUser, dayFromToday, lastEmailTo, login, PASSWORD, runtimeConfig } from "./support.ts";

test("un usuario reserva un turno y lo cancela desde Mis reservas", async ({ page, baseURL }) => {
  const admin = await createUser(baseURL!, { admin: true });
  const resource = await createResource(baseURL!, admin);
  const user = await createUser(baseURL!);
  const { timezone } = await runtimeConfig(baseURL!);

  await page.goto("/login/");
  await login(page, user);
  await expect(page).toHaveURL(/\/resources\/$/);

  await page.getByRole("link", { name: resource }).click();
  await expect(page.getByRole("heading", { name: resource })).toBeVisible();
  await page.getByLabel("Fecha").fill(dayFromToday(timezone, 2));
  await page.getByRole("button", { name: "09:00 a 10:00: Disponible" }).click();
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reserva confirmada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "09:00 a 10:00: Tu reserva" })).toBeDisabled();

  await page.getByRole("link", { name: "Mis reservas" }).click();
  await expect(page.getByText(resource)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Cancelar la reserva de ${resource}`) }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reserva cancelada." })).toBeVisible();
});

test("el admin crea un recurso y lo ve en la lista", async ({ page, baseURL }) => {
  const admin = await createUser(baseURL!, { admin: true });
  const name = `Sala creada en la UI ${Date.now()}`;

  await page.goto("/login/");
  await login(page, admin);
  await page.getByRole("link", { name: "Administración" }).click();
  await page.getByRole("link", { name: "Nuevo recurso" }).click();

  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("checkbox", { name: "Lunes" }).check();
  await page.getByRole("checkbox", { name: "Martes" }).check();
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page).toHaveURL(/\/admin\/resources\/$/);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("Activo");
});

test("recargar la página pide login y, después, vuelve a la ruta de origen (D-2.3)", async ({ page, baseURL }) => {
  const user = await createUser(baseURL!);
  await page.goto("/login/");
  await login(page, user);
  await page.getByRole("link", { name: "Mis reservas" }).click();
  await expect(page).toHaveURL(/\/bookings\/$/);

  // Los tokens viven solo en memoria: recargar pierde la sesión
  await page.reload();
  await expect(page).toHaveURL(/\/login\/\?next=%2Fbookings%2F/);
  await login(page, user);
  await expect(page).toHaveURL(/\/bookings\/$/);
  await expect(page.getByRole("heading", { name: "Mis reservas" })).toBeVisible();
});

test("registro con el código de verificación real del email (CU-01)", async ({ page }) => {
  const email = `ui-signup+${Date.now()}@example.com`;
  await page.goto("/register/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repetir contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/confirm\//);

  // Floci captura el email de verificación de Cognito (verificado en F5)
  const verification = await lastEmailTo(email);
  const code = `${verification.Subject} ${verification.Body.text_part ?? ""}`.match(/\b(\d{6})\b/)?.[1];
  expect(code).toBeTruthy();
  await page.getByLabel("Código").fill(code!);
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page).toHaveURL(/\/login\/\?email=/);
  await login(page, email);
  await expect(page).toHaveURL(/\/resources\/$/);
});
