// Configuración de las Lambdas por variables de entorno, que define Terraform (SPEC §6.5).
export type DbSslMode = "disable" | "require";

export interface LambdaConfig {
  /** APP_TIMEZONE (SPEC §2.2). */
  timezone: string;
  /** ARN del secreto con las credenciales de la base. */
  dbSecretArn: string;
  /**
   * `disable` en Floci; `require` en AWS, donde RDS PostgreSQL 15+ exige TLS por defecto
   * (`rds.force_ssl`). Con `require` se cifra la conexión sin verificar la CA.
   */
  dbSsl: DbSslMode;
  /** Cola de notificaciones. Solo la tiene la Lambda `bookings`, la única que publica (SPEC §6.7). */
  notificationsQueueUrl: string | undefined;
  /** Remitente de los emails. Solo lo usa el `notifier`. */
  sesFrom: string | undefined;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): LambdaConfig {
  const dbSecretArn = env["DB_SECRET_ARN"];
  if (!dbSecretArn) throw new Error("Falta la variable de entorno DB_SECRET_ARN");
  const dbSsl = env["DB_SSL"] ?? "require";
  if (dbSsl !== "disable" && dbSsl !== "require") throw new Error(`DB_SSL inválido: ${dbSsl}`);
  return {
    timezone: env["APP_TIMEZONE"] ?? "America/Argentina/Buenos_Aires",
    dbSecretArn,
    dbSsl,
    notificationsQueueUrl: env["NOTIFICATIONS_QUEUE_URL"] || undefined,
    sesFrom: env["SES_FROM"] || undefined,
  };
}
