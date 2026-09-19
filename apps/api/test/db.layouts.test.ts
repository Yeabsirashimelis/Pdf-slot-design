import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { upsertFile } from '../src/db/files.js'
import { getLayout, getValues, hasDuplicateSlotNames, putLayout, putValues } from '../src/db/layouts.js'

const fileId = 'c'.repeat(64)
const slot = { id: 's1', name: 'Date', order: 0, page: 0, x: 1, y: 2, width: 3, fontId: 'sans' as const, size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left' as const, lineHeight: 1.2 }

describe('layouts and values', () => {
  it('round-trip and overwrite', async () => {
    const db = await createTestDb()
    await upsertFile(db, { fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], blobPath: 'p', createdAt: '2026-09-19T00:00:00.000Z' })
    expect(await getLayout(db, fileId)).toBeNull()
    const layout = { fileId, updatedAt: '2026-09-19T00:00:01.000Z', slots: [slot] }
    await putLayout(db, layout)
    await putLayout(db, { ...layout, updatedAt: '2026-09-19T00:00:02.000Z' })
    expect(await getLayout(db, fileId)).toEqual({ ...layout, updatedAt: '2026-09-19T00:00:02.000Z' })
    const values = { fileId, updatedAt: '2026-09-19T00:00:03.000Z', values: { s1: 'hello' } }
    await putValues(db, values)
    expect(await getValues(db, fileId)).toEqual(values)
  })
  it('hasDuplicateSlotNames finds the first repeated name', () => {
    expect(hasDuplicateSlotNames([{ name: 'A' }, { name: 'B' }])).toBeNull()
    expect(hasDuplicateSlotNames([{ name: 'A' }, { name: 'B' }, { name: 'A' }])).toBe('A')
  })
})
