import { unzipSync } from 'fflate'
import { createApp, type Deps } from '../../src/app.js'
import { createMemoryBlobStore } from '../../src/blob/memoryBlobStore.js'
import { setJobContext } from '../../src/jobs/context.js'
import { embeddedFontProvider } from '../../src/jobs/fonts.js'
import { finishJob, loadJob, renderBatch } from '../../src/jobs/steps.js'
import { createTestDb } from '../helpers/db.js'
import { coreFonts } from '../helpers/fixtures.js'

/** The font bytes the editor ships, read from packages/core's TTFs: what a suite renders its expected output with. */
export const fonts = coreFonts()
/**
 * What the API renders with: the fonts compiled into its bundle, exactly as a Workflow step on
 * Vercel does. Deliberately not `fonts` above -- a suite that checks generated PDFs against the
 * editor's render is then also checking that the embedded copy matches the shipped TTFs. One
 * provider for every boot, so steps.ts parses metrics from it once per worker.
 */
const serverFonts = embeddedFontProvider()

export const API_KEY = 'test-key'
export const API_URL = 'http://api.test'

export type BootedApi = {
  app: ReturnType<typeof createApp>
  deps: Deps & { blobs: ReturnType<typeof createMemoryBlobStore> }
  /** Every job id `POST /files/:id/jobs` handed to `startJob`, in order. Nothing runs until `runJob` is called. */
  started: string[]
  /** A `fetch` that never touches the network: the URL and init go straight into the Hono app. */
  fetchViaApp: typeof fetch
  /** Drives the generation steps for one job the way the Workflow does in production: load, every batch, finish. */
  runJob(jobId: string): Promise<void>
}

/**
 * A complete API in this process: real routes over a fresh PGlite with the
 * committed migrations and an in-memory blob store. `startJob` only records
 * the id -- the test decides when generation runs, so it can observe the
 * queued state first. Each boot replaces the process-level job context, so
 * boot once per test and run its jobs before booting the next.
 */
export async function bootApi(): Promise<BootedApi> {
  const db = await createTestDb()
  const blobs = createMemoryBlobStore()
  const started: string[] = []
  const deps = {
    db,
    blobs,
    config: { apiKey: API_KEY, webOrigin: 'http://web.test' },
    startJob: async (jobId: string) => { started.push(jobId) },
  }
  const app = createApp(deps)
  setJobContext({ db, blobs, fonts: serverFonts })

  const fetchViaApp: typeof fetch = async (input, init) => app.request(input, init)

  async function runJob(jobId: string): Promise<void> {
    const { batches } = await loadJob(jobId)
    for (const batch of batches) await renderBatch(jobId, batch)
    await finishJob(jobId)
  }

  return { app, deps, started, fetchViaApp, runJob }
}

/** Entry name -> bytes, in the order the archive lists them. */
export function openZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}
