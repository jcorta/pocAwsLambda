-- Migración manual: lo que el esquema de Drizzle no puede expresar (SPEC §3.2 y §3.4).

-- RN-01: nunca dos reservas confirmadas solapadas del mismo recurso.
-- Se usa una exclusion constraint sobre rangos (no un índice único sobre starts_at), porque si el
-- admin cambia slot_minutes (RN-08) dos reservas con inicios distintos pueden solaparse.
-- Su violación (SQLSTATE 23P01) se traduce a 409 SLOT_TAKEN.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" = 'confirmed');--> statement-breakpoint

-- Fila única de configuración con los valores por defecto. Se crea acá (no en el seed)
-- para que exista en todos los entornos, incluido AWS real.
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
