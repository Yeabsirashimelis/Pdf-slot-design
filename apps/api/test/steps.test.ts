import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { normalizePdf, renderPdf, toSlots } from '@pdf-slot/core'
import { createTestDb } from './helpers/db.js'
import { createMemoryBlobStore } from '../src/blob/memoryBlobStore.js'
import { readAll } from '../src/blob/blobStore.js'
import { upsertFile } from '../src/db/files.js'
import { putLayout } from '../src/db/layouts.js'
import { createJob, getJob } from '../src/db/jobs.js'
import { setJobContext } from '../src/jobs/context.js'
import { finishJob, loadJob, renderBatch } from '../src/jobs/steps.js'
import { itemPath, zipPath } from '../src/jobs/records.js'
import { coreFonts, FILE_ID, slot, twoPagePdf } from './helpers/fixtures.js'
import { requireContentStreamText } from '../../../packages/core/test/helpers/content-stream.js'

const fonts = coreFonts()

async function setup(records: Record<string, string>[]) {
  const db = await createTestDb()
  const blobs = createMemoryBlobStore()
  const bytes = await twoPagePdf()
  await blobs.put(`files/${FILE_ID}.pdf`, bytes, 'application/pdf')
  await upsertFile(db, { fileId: FILE_ID, name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], blobPath: `files/${FILE_ID}.pdf`, createdAt: '2026-09-19T00:00:00.000Z' })
  const layout = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1, page: 1, fontId: 'mono' })] } as never
  await putLayout(db, layout)
  await createJob(db, { id: 'j1', fileId: FILE_ID, records })
  setJobContext({ db, blobs, fonts: async () => fonts })
  return { db, blobs, bytes, layout }
}

describe('generation steps', () => {
  it('loadJob batches pending indices by 25', async () => {
    await setup(Array.from({ length: 60 }, (_, i) => ({ Name: `n${i}` })))
    const { batches } = await loadJob('j1')
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10])
    expect(batches[0]![0]).toBe(0)
  })

  it('renderBatch writes one PDF per record equal to renderPdf with the same slots; a bad character fails only its item', async () => {
    const { db, blobs, bytes, layout } = await setup([{ Name: 'Abel', Date: '18 Sep' }, { Name: 'Sara', Date: '中文' }])
    await renderBatch('j1', [0, 1])
    const job = (await getJob(db, 'j1'))!
    expect(job.items[0]).toEqual({ index: 0, status: 'done', error: null })
    expect(job.items[1]!.status).toBe('failed')
    expect(job.items[1]!.error).toMatch(/Date/)
    expect([job.done, job.failed]).toEqual([1, 1])

    const generated = await readAll((await blobs.get(itemPath('j1', 0)))!.stream)
    const doc = await normalizePdf(bytes, FILE_ID)
    const expected = await renderPdf(doc, toSlots(layout, { fileId: FILE_ID, updatedAt: 't', values: { s1: 'Abel', s2: '18 Sep' } }), fonts)
    expect(requireContentStreamText(generated)).toBe(requireContentStreamText(expected))
  })

  it('finishJob zips the done items and marks the job done; zero done items marks it failed', async () => {
    const { db, blobs } = await setup([{ Name: 'A' }, { Name: 'B' }])
    await renderBatch('j1', [0, 1])
    await finishJob('j1')
    expect(await getJob(db, 'j1')).toMatchObject({ status: 'done', done: 2, failed: 0 })
    const zip = unzipSync(await readAll((await blobs.get(zipPath('j1')))!.stream))
    expect(Object.keys(zip)).toEqual(['record-0001.pdf', 'record-0002.pdf'])

    const bad = await setup([{ Name: '中文' }])
    setJobContext({ db: bad.db, blobs: bad.blobs, fonts: async () => fonts })
    await renderBatch('j1', [0])
    await finishJob('j1')
    expect(await getJob(bad.db, 'j1')).toMatchObject({ status: 'failed', failed: 1 })
  })
})
