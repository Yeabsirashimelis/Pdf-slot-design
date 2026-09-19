import type { FontBytes } from '@pdf-slot/core'
import type { Db } from '../db/client.js'
import type { BlobStore } from '../blob/blobStore.js'

/** What a generation step needs. Steps run in their own invocations, so they cannot receive this as an argument (Workflow arguments must be serialisable); it is process-level state, set by tests directly and built from the environment in production on first use. */
export type JobContext = { db: Db; blobs: BlobStore; fonts(): Promise<FontBytes> }

let current: JobContext | null = null

export function setJobContext(ctx: JobContext): void {
  current = ctx
}

export async function getJobContext(): Promise<JobContext> {
  if (!current) {
    // Lazy and dynamic on purpose: runtime.ts imports nitro/runtime, which only exists inside a Nitro build.
    const { productionJobContext } = await import('../runtime.js')
    current = await productionJobContext()
  }
  return current
}
