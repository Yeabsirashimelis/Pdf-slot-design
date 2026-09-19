import { desc, eq, sql } from 'drizzle-orm'
import type { FileMeta, StoredFileSummary } from '@pdf-slot/contracts'
import { iso, type Db } from './client.js'
import { files, layouts } from './schema.js'

export type FileRow = FileMeta & { blobPath: string }

const toRow = (r: typeof files.$inferSelect): FileRow => ({
  fileId: r.fileId, name: r.name, pages: r.pages, blobPath: r.blobPath, createdAt: iso(r.createdAt),
})

export async function getFileMeta(db: Db, fileId: string): Promise<FileRow | null> {
  const [r] = await db.select().from(files).where(eq(files.fileId, fileId)).limit(1)
  return r ? toRow(r) : null
}

export async function upsertFile(db: Db, row: FileRow): Promise<void> {
  const insert = { fileId: row.fileId, name: row.name, pages: row.pages, blobPath: row.blobPath, createdAt: new Date(row.createdAt) }
  await db.insert(files).values(insert).onConflictDoUpdate({ target: files.fileId, set: { name: insert.name, pages: insert.pages, blobPath: insert.blobPath } })
}

export async function deleteFile(db: Db, fileId: string): Promise<FileRow | null> {
  const [r] = await db.delete(files).where(eq(files.fileId, fileId)).returning()
  return r ? toRow(r) : null
}

/** Newest first, by the layout's last save or the file's creation. */
export async function listFiles(db: Db): Promise<StoredFileSummary[]> {
  const updatedAt = sql<Date>`coalesce(${layouts.updatedAt}, ${files.createdAt})`
  const rows = await db
    .select({
      fileId: files.fileId, name: files.name, pages: files.pages,
      slotCount: sql<number>`coalesce(jsonb_array_length(${layouts.slots}), 0)`.mapWith(Number),
      updatedAt,
    })
    .from(files)
    .leftJoin(layouts, eq(layouts.fileId, files.fileId))
    .orderBy(desc(updatedAt))
  return rows.map((r) => ({ fileId: r.fileId, name: r.name, pageCount: r.pages.length, slotCount: r.slotCount, updatedAt: iso(new Date(r.updatedAt)) }))
}
