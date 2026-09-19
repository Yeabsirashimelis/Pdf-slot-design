import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { JobRecord, JobStatus } from '@pdf-slot/contracts'
import { iso, type Db } from './client.js'
import { jobItems, jobs } from './schema.js'

/** Every blob path a file's jobs produced -- so deleting the file can delete them too. Rows themselves cascade. */
export async function deleteJobBlobsForFile(db: Db, fileId: string): Promise<string[]> {
  const rows = await db.select({ zipPath: jobs.zipPath, pdfPath: jobItems.pdfPath }).from(jobs)
    .leftJoin(jobItems, eq(jobItems.jobId, jobs.id)).where(eq(jobs.fileId, fileId))
  const paths = new Set<string>()
  for (const r of rows) { if (r.zipPath) paths.add(r.zipPath); if (r.pdfPath) paths.add(r.pdfPath) }
  return Array.from(paths)
}

export async function createJob(db: Db, input: { id: string; fileId: string; records: JobRecord[] }): Promise<void> {
  // Transactional: without it, a failure partway through the chunk loop would leave a job row whose
  // item count never reaches `total`, and nothing would ever retry the missing chunks.
  await db.transaction(async (tx) => {
    await tx.insert(jobs).values({ id: input.id, fileId: input.fileId, status: 'queued', total: input.records.length })
    // Chunked: a single statement with 5000 rows is fine for Postgres but not for every driver's parameter limit.
    for (let i = 0; i < input.records.length; i += 500) {
      await tx.insert(jobItems).values(input.records.slice(i, i + 500).map((record, j) => ({ jobId: input.id, index: i + j, record })))
    }
  })
}

export async function getJobRow(db: Db, id: string) {
  const [r] = await db.select({ id: jobs.id, fileId: jobs.fileId, status: jobs.status, total: jobs.total, zipPath: jobs.zipPath }).from(jobs).where(eq(jobs.id, id)).limit(1)
  return r ?? null
}

export async function getJob(db: Db, id: string): Promise<JobStatus | null> {
  const [r] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1)
  if (!r) return null
  const items = await db.select({ index: jobItems.index, status: jobItems.status, error: jobItems.error })
    .from(jobItems).where(eq(jobItems.jobId, id)).orderBy(asc(jobItems.index))
  return {
    id: r.id, fileId: r.fileId, status: r.status, total: r.total, done: r.done, failed: r.failed, error: r.error,
    createdAt: iso(r.createdAt), finishedAt: r.finishedAt ? iso(r.finishedAt) : null, items,
  }
}

export async function getJobItems(db: Db, jobId: string, indices: number[]): Promise<{ index: number; record: JobRecord }[]> {
  return db.select({ index: jobItems.index, record: jobItems.record }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), inArray(jobItems.index, indices))).orderBy(asc(jobItems.index))
}

export async function markItem(
  db: Db, jobId: string, index: number,
  result: { status: 'done'; pdfPath: string } | { status: 'failed'; error: string },
): Promise<void> {
  // Transactional: the item's own status and the job's running counters must move together, or a crash
  // between the two statements would leave the job's done/failed counts short of its items' real state.
  await db.transaction(async (tx) => {
    if (result.status === 'done') {
      await tx.update(jobItems).set({ status: 'done', pdfPath: result.pdfPath, error: null }).where(and(eq(jobItems.jobId, jobId), eq(jobItems.index, index)))
      await tx.update(jobs).set({ done: sql`${jobs.done} + 1`, status: 'running' }).where(eq(jobs.id, jobId))
    } else {
      await tx.update(jobItems).set({ status: 'failed', error: result.error, pdfPath: null }).where(and(eq(jobItems.jobId, jobId), eq(jobItems.index, index)))
      await tx.update(jobs).set({ failed: sql`${jobs.failed} + 1`, status: 'running' }).where(eq(jobs.id, jobId))
    }
  })
}

export async function setJobStatus(
  db: Db, id: string,
  patch: { status: 'queued' | 'running' | 'done' | 'failed'; error?: string | null; zipPath?: string | null; finishedAt?: Date | null },
): Promise<void> {
  await db.update(jobs).set(patch).where(eq(jobs.id, id))
}

export async function listDoneItemPaths(db: Db, jobId: string): Promise<{ index: number; pdfPath: string }[]> {
  const rows = await db.select({ index: jobItems.index, pdfPath: jobItems.pdfPath }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, 'done'))).orderBy(asc(jobItems.index))
  return rows.flatMap((r) => (r.pdfPath ? [{ index: r.index, pdfPath: r.pdfPath }] : []))
}
