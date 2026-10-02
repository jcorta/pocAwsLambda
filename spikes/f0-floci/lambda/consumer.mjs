// Consumidor SQS del spike F0: simula el notifier (envía un email por mensaje, con respuesta parcial).
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

export const handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records ?? []) {
    try {
      const body = JSON.parse(record.body);
      if (body.fail) throw new Error("fallo simulado");
      await ses.send(
        new SendEmailCommand({
          Source: process.env.SES_FROM,
          Destination: { ToAddresses: ["consumer@example.com"] },
          Message: { Subject: { Data: `consumer ${body.marker ?? "sin-marker"}` }, Body: { Text: { Data: record.body } } },
        }),
      );
    } catch (err) {
      console.log(JSON.stringify({ level: "error", messageId: record.messageId, error: err.message }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
