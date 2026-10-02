import { Logger } from "@aws-lambda-powertools/logger";
import { describe, expect, it, vi } from "vitest";
import { sqsPublisher } from "./notifications.ts";

describe("sqsPublisher (RN-07)", () => {
  it("si armar el evento falla, no lanza: registra notification_publish_failed", async () => {
    const logger = new Logger({ serviceName: "test", logLevel: "SILENT" });
    const spy = vi.spyOn(logger, "error");
    const publish = sqsPublisher("http://localhost:4566/000000000000/notifications", logger);
    await expect(
      publish(async () => {
        throw new Error("la base no respondió");
      }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      "notification_publish_failed",
      expect.objectContaining({ event: "notification_publish_failed" }),
    );
  });

  it("si no hay evento que publicar, no hace nada", async () => {
    const logger = new Logger({ serviceName: "test", logLevel: "SILENT" });
    const spy = vi.spyOn(logger, "error");
    await sqsPublisher("http://q", logger)(async () => null);
    expect(spy).not.toHaveBeenCalled();
  });
});
