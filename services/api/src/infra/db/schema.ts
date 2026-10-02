// Esquema de la base de datos (SPEC §3.2). Las restricciones que Drizzle no expresa
// (exclusion constraint de RN-01 y extensión btree_gist) están en la migración SQL manual.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Espejo mínimo de Cognito: `id` es el `sub` del token. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  ...timestamps,
});

export const SLOT_MINUTES = [15, 30, 45, 60, 90, 120] as const;

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    description: text("description"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    slotMinutes: smallint("slot_minutes").notNull().default(60),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("resources_name_length", sql`char_length(${t.name}) between 1 and 100`),
    check("resources_description_length", sql`${t.description} is null or char_length(${t.description}) <= 1000`),
    check("resources_slot_minutes", sql`${t.slotMinutes} in (${sql.raw(SLOT_MINUTES.join(", "))})`),
  ],
);

/** Una franja por día de semana (ISO: 1 = lunes). La duración múltiplo de `slot_minutes` se valida en la aplicación. */
export const resourceOpeningHours = pgTable(
  "resource_opening_hours",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.weekday] }),
    check("resource_opening_hours_weekday", sql`${t.weekday} between 1 and 7`),
    check("resource_opening_hours_range", sql`${t.closesAt} > ${t.opensAt}`),
  ],
);

export const bookingStatus = pgEnum("booking_status", ["confirmed", "cancelled"]);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatus("status").notNull().default("confirmed"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check("bookings_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_cancelled_consistency", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    index("bookings_user_starts_idx").on(t.userId, t.startsAt),
    index("bookings_resource_starts_idx").on(t.resourceId, t.startsAt),
  ],
);

/** Fila única (`id = 1`). La crea la migración inicial con los valores por defecto (SPEC §3.4). */
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    maxActiveBookingsPerUser: smallint("max_active_bookings_per_user").notNull().default(3),
    cancellationMinHours: smallint("cancellation_min_hours").notNull().default(2),
    bookingHorizonDays: smallint("booking_horizon_days").notNull().default(30),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("settings_single_row", sql`${t.id} = 1`),
    check("settings_max_active", sql`${t.maxActiveBookingsPerUser} >= 1`),
    check("settings_cancellation_min_hours", sql`${t.cancellationMinHours} >= 0`),
    check("settings_booking_horizon", sql`${t.bookingHorizonDays} >= 1`),
  ],
);

/** Idempotencia de la Lambda notificadora (CU-10). */
export const notificationLog = pgTable(
  "notification_log",
  {
    eventId: uuid("event_id").primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    type: text("type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("notification_log_type", sql`${t.type} in ('booking_confirmed', 'booking_cancelled')`)],
);
