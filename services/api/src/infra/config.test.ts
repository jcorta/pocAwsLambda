import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";
import { lazyServiceDeps } from "./runtime.ts";

describe("readConfig", () => {
  it("lee la configuración y usa Buenos Aires y TLS por defecto", () =>
    expect(readConfig({ DB_SECRET_ARN: "arn:x" })).toEqual({
      timezone: "America/Argentina/Buenos_Aires",
      dbSecretArn: "arn:x",
      dbSsl: "require",
      notificationsQueueUrl: undefined,
      sesFrom: undefined,
    }));

  it("lee la cola de notificaciones y el remitente", () =>
    expect(
      readConfig({ DB_SECRET_ARN: "arn:x", NOTIFICATIONS_QUEUE_URL: "http://q", SES_FROM: "no-reply@example.com" }),
    ).toMatchObject({ notificationsQueueUrl: "http://q", sesFrom: "no-reply@example.com" }));

  it("respeta APP_TIMEZONE y DB_SSL=disable (Floci)", () =>
    expect(readConfig({ DB_SECRET_ARN: "arn:x", APP_TIMEZONE: "UTC", DB_SSL: "disable" })).toMatchObject({
      timezone: "UTC",
      dbSsl: "disable",
    }));

  it("falla si falta DB_SECRET_ARN", () => expect(() => readConfig({})).toThrow("DB_SECRET_ARN"));
  it("falla con un DB_SSL inválido", () => expect(() => readConfig({ DB_SECRET_ARN: "x", DB_SSL: "maybe" })).toThrow());
});

describe("lazyServiceDeps", () => {
  it("si la inicialización falla, la siguiente invocación reintenta en lugar de cachear el error", async () => {
    const env: NodeJS.ProcessEnv = {};
    const getDeps = lazyServiceDeps(env);
    await expect(getDeps()).rejects.toThrow("DB_SECRET_ARN");
    env["DB_SSL"] = "maybe";
    env["DB_SECRET_ARN"] = "arn:x";
    // Si hubiera cacheado el primer error, volvería a decir DB_SECRET_ARN
    await expect(getDeps()).rejects.toThrow("DB_SSL");
  });
});
