import { eq } from 'drizzle-orm'
import type { TemplateLayout, TemplateValues } from '@pdf-slot/core'
import { iso, type Db } from './client.js'
import { layouts, values } from './schema.js'

export async function getLayout(db: Db, fileId: string): Promise<TemplateLayout | null> {
  const [r] = await db.select().from(layouts).where(eq(layouts.fileId, fileId)).limit(1)
  return r ? { fileId: r.fileId, slots: r.slots, updatedAt: iso(r.updatedAt) } : null
}

export async function putLayout(db: Db, layout: TemplateLayout): Promise<void> {
  const row = { fileId: layout.fileId, slots: layout.slots, updatedAt: new Date(layout.updatedAt) }
  await db.insert(layouts).values(row).onConflictDoUpdate({ target: layouts.fileId, set: { slots: row.slots, updatedAt: row.updatedAt } })
}

export async function getValues(db: Db, fileId: string): Promise<TemplateValues | null> {
  const [r] = await db.select().from(values).where(eq(values.fileId, fileId)).limit(1)
  return r ? { fileId: r.fileId, values: r.values, updatedAt: iso(r.updatedAt) } : null
}

export async function putValues(db: Db, v: TemplateValues): Promise<void> {
  const row = { fileId: v.fileId, values: v.values, updatedAt: new Date(v.updatedAt) }
  await db.insert(values).values(row).onConflictDoUpdate({ target: values.fileId, set: { values: row.values, updatedAt: row.updatedAt } })
}

/** Slot names are a record's keys in bulk generation, so a file cannot have two slots with one name. */
export function hasDuplicateSlotNames(slots: { name: string }[]): string | null {
  const seen = new Set<string>()
  for (const { name } of slots) {
    if (seen.has(name)) return name
    seen.add(name)
  }
  return null
}
