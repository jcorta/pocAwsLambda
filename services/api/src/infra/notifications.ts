// Implementaciones con AWS de la publicación (SQS) y del envío de emails (SES). Clientes sin endpoint explícito:
// en Floci el SDK toma AWS_ENDPOINT_URL (hallazgo A4).
import type { Logger } from "@aws-lambda-powertools/logger";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { PublishEvent } from "../notifications/event.ts";
import type { Email } from "../notifications/templates.ts";

/** Publicador de eventos en SQS. Nunca lanza: una falla se registra como `notification_publish_failed` (SPEC §3.3). */
export function sqsPublisher(queueUrl: string, logger: Logger): PublishEvent {
  // Sin esto, el SDK envía al host de la QueueUrl (localhost:4566), que dentro de la Lambda no es Floci (hallazgo A2)
  const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
  return async (build) => {
    let event;
    try {
      event = await build();
      if (!event) return;
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(event) }));
    } catch (err) {
      logger.error("notification_publish_failed", {
        event: "notification_publish_failed",
        bookingId: event?.booking.id,
        type: event?.type,
        error: err as Error,
      });
    }
  };
}

export function sesSender(from: string): (to: string, email: Email) => Promise<void> {
  const ses = new SESClient({});
  return async (to, email) => {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: { Text: { Data: email.text, Charset: "UTF-8" }, Html: { Data: email.html, Charset: "UTF-8" } },
        },
      }),
    );
  };
}
