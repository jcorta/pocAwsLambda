// Diagnóstico de los E2E de UI: si un test falla, imprime la consola del navegador, las llamadas de red
// que fallaron o respondieron >= 400 y las alertas visibles. Así una falla en la CI se puede entender sin trazas.
import { test, type Page } from "@playwright/test";

const logs = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const lines: string[] = [];
  logs.set(page, lines);
  page.on("console", (m) => lines.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => lines.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => lines.push(`[requestfailed] ${r.method()} ${r.url()} → ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) lines.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const alerts = await page
    .getByRole("alert")
    .allTextContents()
    .catch(() => []);
  console.log(
    [
      `\n──── Diagnóstico: ${testInfo.title} ────`,
      `URL: ${page.url()}`,
      `Alertas: ${alerts.length ? alerts.join(" | ") : "(ninguna)"}`,
      ...(logs.get(page) ?? []),
      "────",
    ].join("\n"),
  );
});
