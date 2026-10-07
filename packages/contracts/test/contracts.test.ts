import { describe, expect, it } from 'vitest'
import {
  createJobRequestSchema, fileIdSchema, fileMetaSchema, jobStatusSchema, storedFileSummarySchema, templateLayoutSchema,
  MAX_JOB_RECORDS,
} from '../src/index.js'

const slot = {
  id: 's1', name: 'Date', order: 0, page: 0, x: 10, y: 700, width: 200,
  fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
}
const hash = 'a'.repeat(64)

describe('contracts', () => {
  it('a file id is a 64-hex content hash or a 32-hex random id', () => {
    expect(fileIdSchema.safeParse(hash).success).toBe(true)
    expect(fileIdSchema.safeParse('b'.repeat(32)).success).toBe(true)
    expect(fileIdSchema.safeParse('not-an-id').success).toBe(false)
  })

  it('a layout round-trips; height is optional; an unknown font is refused; updatedAt must be ISO', () => {
    const layout = { fileId: hash, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot, { ...slot, id: 's2', height: 40 }] }
    expect(templateLayoutSchema.parse(layout)).toEqual(layout)
    expect(templateLayoutSchema.safeParse({ ...layout, slots: [{ ...slot, fontId: 'comic' }] }).success).toBe(false)
    expect(templateLayoutSchema.safeParse({ ...layout, updatedAt: 't' }).success).toBe(false)
  })

  it('file meta createdAt must be an ISO datetime, like every other timestamp the API returns', () => {
    const meta = { fileId: hash, name: 'a.pdf', pages: [{ width: 612, height: 792 }], createdAt: '2026-09-19T00:00:00.000Z' }
    expect(fileMetaSchema.parse(meta)).toEqual(meta)
    expect(fileMetaSchema.safeParse({ ...meta, createdAt: 't' }).success).toBe(false)
    expect(fileMetaSchema.safeParse({ ...meta, createdAt: '2026-09-19' }).success).toBe(false)
  })

  it('a job request needs 1..MAX_JOB_RECORDS string records', () => {
    expect(createJobRequestSchema.safeParse({ records: [] }).success).toBe(false)
    expect(createJobRequestSchema.safeParse({ records: [{ Name: 'Abel' }] }).success).toBe(true)
    expect(createJobRequestSchema.safeParse({ records: [{ Name: 3 }] }).success).toBe(false)
    expect(createJobRequestSchema.safeParse({ records: Array(MAX_JOB_RECORDS + 1).fill({ a: 'b' }) }).success).toBe(false)
  })

  it('job status and file summary shapes parse', () => {
    expect(jobStatusSchema.parse({
      id: 'j1', fileId: hash, status: 'running', total: 2, done: 1, failed: 0, error: null,
      createdAt: '2026-09-19T00:00:00.000Z', finishedAt: null,
      items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'pending', error: null }],
    }).status).toBe('running')
    expect(storedFileSummarySchema.parse({ fileId: hash, name: 'a.pdf', pageCount: 2, slotCount: 3, updatedAt: 't' }).slotCount).toBe(3)
  })
})

describe('a layout saved before tables had names still opens', () => {
  const style = { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 }
  const table = (over = {}) => ({
    id: 't1', page: 0, x: 40, y: 500,
    columns: [{ key: 'c1', name: 'No', width: 40 }],
    rowHeights: [22],
    style,
    ...over,
  })
  const layout = (tables: unknown[]) => templateLayoutSchema.parse({
    fileId: hash, slots: [slot], tables, updatedAt: '2026-09-29T00:00:00.000Z',
  })

  it('parses a table with no name, and names it by position', () => {
    // The regression: making the name required stopped every file saved
    // before today from opening at all.
    expect(layout([table()]).tables?.[0]?.name).toBe('Table 1')
    expect(layout([table(), table({ id: 't2' })]).tables?.map((t) => t.name)).toEqual(['Table 1', 'Table 2'])
  })

  it('leaves a name that is already there alone', () => {
    expect(layout([table({ name: 'Change orders' })]).tables?.[0]?.name).toBe('Change orders')
  })

  it('will not hand two tables the same name, however they were saved', () => {
    // An old table numbered into a name a named table already has.
    expect(layout([table({ name: 'Table 2' }), table({ id: 't2' })]).tables?.map((t) => t.name))
      .toEqual(['Table 2', 'Table 2 2'])
  })

  it('still refuses a name that is there but empty', () => {
    expect(() => layout([table({ name: '' })])).toThrow()
  })
})
