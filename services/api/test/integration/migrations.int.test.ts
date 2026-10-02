import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/infra/db/migrate.ts";
import { MIGRATIONS_FOLDER, startTestDatabase, type TestDatabase } from "../support/postgres.ts";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

/** Ejecuta la query y devuelve el código SQLSTATE del error, o null si no falló. */
async function sqlState(query: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.pool.query(query, params);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

async function insertResource(name: string, slotMinutes = 60): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "insert into resources (name, slot_minutes) values ($1, $2) returning id",
    [name, slotMinutes],
  );
  return rows[0]!.id;
}

async function insertBooking(resourceId: string, startsAt: string, endsAt: string, status = "confirmed") {
  await db.pool.query(
    `insert into bookings (resource_id, user_id, starts_at, ends_at, status, cancelled_at)
     values ($1, 'user-1', $2, $3, $4::booking_status, case when $4::text = 'cancelled' then now() end)`,
    [resourceId, startsAt, endsAt, status],
  );
}

describe("migraciones (SPEC §3.5)", () => {
  it("crean todas las tablas sobre una base vacía", async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "bookings",
      "notification_log",
      "resource_opening_hours",
      "resources",
      "settings",
      "users",
    ]);
  });

  it("crean la fila única de settings con los valores por defecto (SPEC §3.4)", async () => {
    const { rows } = await db.pool.query("select * from settings");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      max_active_bookings_per_user: 3,
      cancellation_min_hours: 2,
      booking_horizon_days: 30,
    });
  });

  it("son idempotentes: re-ejecutarlas no falla ni duplica datos", async () => {
    await runMigrations(db.pool, MIGRATIONS_FOLDER);
    const { rows } = await db.pool.query("select count(*)::int as n from settings");
    expect(rows[0].n).toBe(1);
  });
});

describe("restricciones de la base", () => {
  beforeAll(async () => {
    await db.pool.query("insert into users (id, email) values ('user-1', 'user@example.com')");
  });

  describe("RN-01: exclusion constraint bookings_no_overlap", () => {
    let resourceId: string;

    beforeAll(async () => {
      resourceId = await insertResource("Sala RN-01");
      await insertBooking(resourceId, "2026-10-05T10:00:00-03:00", "2026-10-05T11:00:00-03:00");
    });

    it("rechaza una reserva confirmada que se solapa (23P01)", async () => {
      const code = await sqlState(
        `insert into bookings (resource_id, user_id, starts_at, ends_at)
         values ($1, 'user-1', '2026-10-05T10:30:00-03:00', '2026-10-05T11:30:00-03:00')`,
        [resourceId],
      );
      expect(code).toBe("23P01");
    });

    it("permite una reserva contigua, porque el rango es [inicio, fin)", async () => {
      await expect(
        insertBooking(resourceId, "2026-10-05T11:00:00-03:00", "2026-10-05T12:00:00-03:00"),
      ).resolves.toBeUndefined();
    });

    it("ignora las reservas canceladas", async () => {
      await expect(
        insertBooking(resourceId, "2026-10-05T10:00:00-03:00", "2026-10-05T11:00:00-03:00", "cancelled"),
      ).resolves.toBeUndefined();
    });

    it("permite el mismo horario en otro recurso", async () => {
      const other = await insertResource("Sala RN-01 bis");
      await expect(
        insertBooking(other, "2026-10-05T10:00:00-03:00", "2026-10-05T11:00:00-03:00"),
      ).resolves.toBeUndefined();
    });
  });

  it("rechaza un slot_minutes fuera de los permitidos (23514)", async () => {
    expect(await sqlState("insert into resources (name, slot_minutes) values ('Sala 50', 50)")).toBe("23514");
  });

  it("rechaza nombres de recurso duplicados (23505)", async () => {
    await insertResource("Sala duplicada");
    expect(await sqlState("insert into resources (name) values ('Sala duplicada')")).toBe("23505");
  });

  it("rechaza una franja con cierre anterior o igual a la apertura (23514)", async () => {
    const resourceId = await insertResource("Sala franja");
    expect(
      await sqlState(
        "insert into resource_opening_hours (resource_id, weekday, opens_at, closes_at) values ($1, 1, '10:00', '10:00')",
        [resourceId],
      ),
    ).toBe("23514");
  });

  it("rechaza una segunda fila de settings (23514)", async () => {
    expect(await sqlState("insert into settings (id) values (2)")).toBe("23514");
  });

  it("exige consistencia entre status y cancelled_at (23514)", async () => {
    const resourceId = await insertResource("Sala consistencia");
    expect(
      await sqlState(
        `insert into bookings (resource_id, user_id, starts_at, ends_at, status)
         values ($1, 'user-1', '2026-10-06T10:00:00-03:00', '2026-10-06T11:00:00-03:00', 'cancelled')`,
        [resourceId],
      ),
    ).toBe("23514");
  });
});
