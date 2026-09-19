import type { Deps } from './app.js'
import type { JobContext } from './jobs/context.js'

export async function productionDeps(): Promise<Deps> {
  throw new Error('wired in Task 9')
}

export async function productionJobContext(): Promise<JobContext> {
  throw new Error('wired in Task 9')
}
