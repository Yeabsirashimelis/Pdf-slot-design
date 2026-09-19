import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { deleteFile, getFileMeta, listFiles, upsertFile } from '../src/db/files.js'
import { putLayout } from '../src/db/layouts.js'

const id = (c: string) => c.repeat(64)
const row = (fileId: string, name: string, createdAt: string) => ({
  fileId, name, pages: [{ width: 612, height: 792 }], blobPath: `files/${fileId}.pdf`, createdAt,
})

describe('files repository', () => {
  it('upserts, reads back, and lists newest first with the slot count', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    await upsertFile(db, row(id('b'), 'b.pdf', '2026-09-02T00:00:00.000Z'))
    await putLayout(db, { fileId: id('a'), updatedAt: '2026-09-03T00:00:00.000Z', slots: [
      { id: 's1', name: 'Date', order: 0, page: 0, x: 1, y: 2, width: 3, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    ] })
    expect(await getFileMeta(db, id('a'))).toEqual(row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    expect(await listFiles(db)).toEqual([
      { fileId: id('a'), name: 'a.pdf', pageCount: 1, slotCount: 1, updatedAt: '2026-09-03T00:00:00.000Z' },
      { fileId: id('b'), name: 'b.pdf', pageCount: 1, slotCount: 0, updatedAt: '2026-09-02T00:00:00.000Z' },
    ])
  })
  it('upsert of the same id keeps one row and updates the name', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    await upsertFile(db, row(id('a'), 'renamed.pdf', '2026-09-01T00:00:00.000Z'))
    expect((await listFiles(db)).map((f) => f.name)).toEqual(['renamed.pdf'])
  })
  it('delete returns the row and cascades the layout; unknown id returns null', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    expect((await deleteFile(db, id('a')))?.blobPath).toBe(`files/${id('a')}.pdf`)
    expect(await getFileMeta(db, id('a'))).toBeNull()
    expect(await deleteFile(db, id('a'))).toBeNull()
  })
})
