import { FatalError } from 'workflow'
import { finishJob, loadJob, renderBatch } from './steps.js'
import { getJobContext } from './context.js'
import { setJobStatus } from '../db/jobs.js'

/** One PDF per record, in batches, then a zip. Each step is retried by Workflow on a thrown error; a FatalError marks the job failed. */
export async function generateJob(jobId: string): Promise<void> {
  'use workflow'
  try {
    const { batches } = await loadJob(jobId)
    for (const batch of batches) await renderBatch(jobId, batch)
    await finishJob(jobId)
  } catch (err) {
    await markJobFailed(jobId, err instanceof Error ? err.message : String(err))
    throw new FatalError(`Job ${jobId} failed`)
  }
}

async function markJobFailed(jobId: string, message: string): Promise<void> {
  'use step'
  const { db } = await getJobContext()
  await setJobStatus(db, jobId, { status: 'failed', error: message, finishedAt: new Date() })
}
