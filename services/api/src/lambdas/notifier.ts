// Lambda `notifier` (SPEC §6.4): consume la cola `notifications` y envía los emails por SES.
// Respuesta parcial (ReportBatchItemFailures): solo se reintentan los mensajes que fallaron, y tras
// 3 intentos pasan a la DLQ (CU-10).
import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { readConfig } from "../infra/config.ts";
import { createDb } from "../infra/db/client.ts";
import { sesSender } from "../infra/notifications.ts";
import { createPool } from "../infra/runtime.ts";
import { BookingEventSchema } from "../notifications/event.ts";
import { processBookingEvent, type NotifierDeps } from "../services/notifications.ts";

const logger = new Logger({ serviceName: "reservas-notifier" });
let deps: Promise<NotifierDeps> | undefined;

function getDeps(): Promise<NotifierDeps> {
  deps ??= (async () => {
    const config = readConfig();
    if (!config.sesFrom) throw new Error("Falta la variable de entorno SES_FROM");
    // Lotes de hasta 10 mensajes procesados en secuencia: alcanza con una conexión
    return { db: createDb(await createPool(config)), timezone: config.timezone, sendEmail: sesSender(config.sesFrom) };
  })().catch((err: unknown) => {
    deps = undefined;
    throw err;
  });
  return deps;
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  const d = await getDeps();
  for (const record of event.Records) {
    try {
      const parsed = BookingEventSchema.safeParse(JSON.parse(record.body));
      // Un mensaje mal formado no se va a arreglar reintentando: se marca como fallido y termina en la DLQ
      if (!parsed.success) throw new Error(`Evento inválido: ${parsed.error.message}`);
      const result = await processBookingEvent(d, parsed.data);
      logger.info("notificación procesada", {
        messageId: record.messageId,
        eventId: parsed.data.eventId,
        type: parsed.data.type,
        result,
      });
    } catch (err) {
      logger.error("notificación fallida", { messageId: record.messageId, error: err as Error });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
