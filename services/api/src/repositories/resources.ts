import { asc, eq, inArray } from "drizzle-orm";
import type { OpeningHours } from "../domain/types.ts";
import type { DbOrTx } from "../infra/db/client.ts";
import { resourceOpeningHours, resources } from "../infra/db/schema.ts";

export interface ResourceInput {
  name: string;
  description?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  slotMinutes: number;
  openingHours: OpeningHours[];
  isActive?: boolean | undefined;
}

export interface Resource {
  id: string;
  name: string;
  description: string | null;
  attributes: Record<string, unknown>;
  slotMinutes: number;
  isActive: boolean;
  openingHours: OpeningHours[];
  createdAt: Date;
  updatedAt: Date;
}

/** Postgres devuelve `time` como "HH:mm:ss"; la API usa "HH:mm" (SPEC §4.1). */
const hhmm = (time: string) => time.slice(0, 5);

async function loadOpeningHours(db: DbOrTx, ids: string[]): Promise<Map<string, OpeningHours[]>> {
  const byResource = new Map<string, OpeningHours[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byResource;
  const rows = await db
    .select()
    .from(resourceOpeningHours)
    .where(inArray(resourceOpeningHours.resourceId, ids))
    .orderBy(asc(resourceOpeningHours.weekday));
  for (const r of rows) {
    byResource.get(r.resourceId)!.push({ weekday: r.weekday, opensAt: hhmm(r.opensAt), closesAt: hhmm(r.closesAt) });
  }
  return byResource;
}

export async function listResources(db: DbOrTx, opts: { includeInactive: boolean }): Promise<Resource[]> {
  const rows = await db
    .select()
    .from(resources)
    .where(opts.includeInactive ? undefined : eq(resources.isActive, true))
    .orderBy(asc(resources.name));
  const hours = await loadOpeningHours(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, openingHours: hours.get(r.id)! }));
}

export async function getResource(db: DbOrTx, id: string): Promise<Resource | null> {
  const [row] = await db.select().from(resources).where(eq(resources.id, id));
  if (!row) return null;
  const hours = await loadOpeningHours(db, [id]);
  return { ...row, openingHours: hours.get(id)! };
}

async function replaceOpeningHours(tx: DbOrTx, resourceId: string, openingHours: OpeningHours[]): Promise<void> {
  await tx.delete(resourceOpeningHours).where(eq(resourceOpeningHours.resourceId, resourceId));
  if (openingHours.length > 0) {
    await tx.insert(resourceOpeningHours).values(openingHours.map((h) => ({ ...h, resourceId })));
  }
}

export async function insertResource(tx: DbOrTx, input: ResourceInput): Promise<string> {
  const [row] = await tx
    .insert(resources)
    .values({
      name: input.name,
      description: input.description ?? null,
      attributes: input.attributes ?? {},
      slotMinutes: input.slotMinutes,
      isActive: input.isActive ?? true,
    })
    .returning({ id: resources.id });
  await replaceOpeningHours(tx, row!.id, input.openingHours);
  return row!.id;
}

/** Reemplaza el recurso completo, incluido el horario (PUT, SPEC §4.5). Devuelve false si no existe. */
export async function replaceResource(tx: DbOrTx, id: string, input: ResourceInput): Promise<boolean> {
  const updated = await tx
    .update(resources)
    .set({
      name: input.name,
      description: input.description ?? null,
      attributes: input.attributes ?? {},
      slotMinutes: input.slotMinutes,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    })
    .where(eq(resources.id, id))
    .returning({ id: resources.id });
  if (updated.length === 0) return false;
  await replaceOpeningHours(tx, id, input.openingHours);
  return true;
}
