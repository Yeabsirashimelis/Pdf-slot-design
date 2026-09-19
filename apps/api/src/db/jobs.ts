import { eq } from 'drizzle-orm'
import type { Db } from './client.js'
import { jobItems, jobs } from './schema.js'

/** Every blob path a file's jobs produced -- so deleting the file can delete them too. Rows themselves cascade. */
export async function deleteJobBlobsForFile(db: Db, fileId: string): Promise<string[]> {
  const rows = await db.select({ zipPath: jobs.zipPath, pdfPath: jobItems.pdfPath }).from(jobs)
    .leftJoin(jobItems, eq(jobItems.jobId, jobs.id)).where(eq(jobs.fileId, fileId))
  const paths = new Set<string>()
  for (const r of rows) { if (r.zipPath) paths.add(r.zipPath); if (r.pdfPath) paths.add(r.pdfPath) }
  return Array.from(paths)
}
