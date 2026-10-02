CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_range" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_cancelled_consistency" CHECK (("bookings"."status" = 'cancelled') = ("bookings"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_type" CHECK ("notification_log"."type" in ('booking_confirmed', 'booking_cancelled'))
);
--> statement-breakpoint
CREATE TABLE "resource_opening_hours" (
	"resource_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "resource_opening_hours_resource_id_weekday_pk" PRIMARY KEY("resource_id","weekday"),
	CONSTRAINT "resource_opening_hours_weekday" CHECK ("resource_opening_hours"."weekday" between 1 and 7),
	CONSTRAINT "resource_opening_hours_range" CHECK ("resource_opening_hours"."closes_at" > "resource_opening_hours"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slot_minutes" smallint DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_name_unique" UNIQUE("name"),
	CONSTRAINT "resources_name_length" CHECK (char_length("resources"."name") between 1 and 100),
	CONSTRAINT "resources_description_length" CHECK ("resources"."description" is null or char_length("resources"."description") <= 1000),
	CONSTRAINT "resources_slot_minutes" CHECK ("resources"."slot_minutes" in (15, 30, 45, 60, 90, 120))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"max_active_bookings_per_user" smallint DEFAULT 3 NOT NULL,
	"cancellation_min_hours" smallint DEFAULT 2 NOT NULL,
	"booking_horizon_days" smallint DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_max_active" CHECK ("settings"."max_active_bookings_per_user" >= 1),
	CONSTRAINT "settings_cancellation_min_hours" CHECK ("settings"."cancellation_min_hours" >= 0),
	CONSTRAINT "settings_booking_horizon" CHECK ("settings"."booking_horizon_days" >= 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_opening_hours" ADD CONSTRAINT "resource_opening_hours_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_user_starts_idx" ON "bookings" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_resource_starts_idx" ON "bookings" USING btree ("resource_id","starts_at");