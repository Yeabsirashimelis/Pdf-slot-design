import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { upsertFile } from '../src/db/files.js'
import { createJob, getJob, getJobItems, listDoneItemPaths, markItem, setJobStatus } from '../src/db/jobs.js'
import { FILE_ID } from './helpers/fixtures.js'

describe('jobs repository', () => {
  it('creates a queued job with pending items, marks items and counts, finishes', async () => {
    const db = await createTestDb()
    await upsertFile(db, { fileId: FILE_ID, name: 'a.pdf', pages: [{ width: 1, height: 1 }], blobPath: 'p', createdAt: '2026-09-19T00:00:00.000Z' })
    await createJob(db, { id: 'j1', fileId: FILE_ID, records: [{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }] })
    expect(await getJob(db, 'j1')).toMatchObject({ id: 'j1', status: 'queued', total: 3, done: 0, failed: 0, items: [
      { index: 0, status: 'pending', error: null }, { index: 1, status: 'pending', error: null }, { index: 2, status: 'pending', error: null },
    ] })
    expect(await getJobItems(db, 'j1', [2, 0])).toEqual([{ index: 0, record: { Name: 'A' } }, { index: 2, record: { Name: 'C' } }])
    await markItem(db, 'j1', 0, { status: 'done', pdfPath: 'jobs/j1/record-0001.pdf' })
    await markItem(db, 'j1', 1, { status: 'failed', error: 'boom' })
    const job = (await getJob(db, 'j1'))!
    expect([job.done, job.failed]).toEqual([1, 1])
    expect(job.items[1]).toEqual({ index: 1, status: 'failed', error: 'boom' })
    expect(await listDoneItemPaths(db, 'j1')).toEqual([{ index: 0, pdfPath: 'jobs/j1/record-0001.pdf' }])
    await setJobStatus(db, 'j1', { status: 'done', zipPath: 'jobs/j1/all.zip', finishedAt: new Date('2026-09-19T01:00:00.000Z') })
    expect(await getJob(db, 'j1')).toMatchObject({ status: 'done', finishedAt: '2026-09-19T01:00:00.000Z' })
    expect(await getJob(db, 'nope')).toBeNull()
  })

  it('createJob runs the whole chunk loop inside one transaction: 1200 records -> exactly 1200 items and total 1200', async () => {
    // This exercises the chunk loop (500 records/insert -> 3 inserts) running inside one db.transaction.
    // It does not force a mid-transaction failure to prove rollback: doing that cleanly (e.g. making the
    // second chunk's insert fail without also failing the first) needs either driver-level fault injection
    // or a constraint violation timed to land in a later chunk, neither of which this repository's public
    // surface exposes. Forcing one via a duplicate (jobId, index) primary key collision would require
    // reaching into internals the function doesn't take as input.
    const db = await createTestDb()
    await upsertFile(db, { fileId: FILE_ID, name: 'a.pdf', pages: [{ width: 1, height: 1 }], blobPath: 'p', createdAt: '2026-09-19T00:00:00.000Z' })
    const records = Array.from({ length: 1200 }, (_, i) => ({ Name: `n${i}` }))
    await createJob(db, { id: 'j2', fileId: FILE_ID, records })
    const job = await getJob(db, 'j2')
    expect(job?.total).toBe(1200)
    expect(job?.items).toHaveLength(1200)
    expect(await getJobItems(db, 'j2', [0, 500, 1199])).toEqual([
      { index: 0, record: { Name: 'n0' } },
      { index: 500, record: { Name: 'n500' } },
      { index: 1199, record: { Name: 'n1199' } },
    ])
  })
})
