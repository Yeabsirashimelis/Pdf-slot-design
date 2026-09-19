import path from 'node:path'
import { useStorage } from 'nitro/storage'
import { start } from 'workflow/api'
import type { Deps } from './app.js'
import { readConfig } from './config.js'
import { createDb } from './db/client.js'
import { createVercelBlobStore } from './blob/vercelBlobStore.js'
import { createDiskBlobStore } from './blob/diskBlobStore.js'
import type { BlobStore } from './blob/blobStore.js'
import { diskFontSource, loadFonts, type FontSource } from './jobs/fonts.js'
import type { JobContext } from './jobs/context.js'
import { generateJob } from './jobs/generateJob.js'

const config = readConfig(process.env)
const db = createDb(config.databaseUrl)
// BLOB_DIR opts into local, file-backed blob storage (see config.ts); otherwise Vercel Blob.
const blobs: BlobStore = config.blobDir ? createDiskBlobStore(config.blobDir) : createVercelBlobStore(config.blobToken)

/**
 * Fonts bundled by nitro.config.ts `serverAssets` from packages/core: this is what a real
 * `nitro build` output serves (verified: `useStorage('assets:fonts').getItemRaw` returns the
 * bundled bytes there). `nitro dev`'s watcher does not mount `serverAssets` the same way, so the
 * lookup comes back empty in dev; fall back to reading the files straight off disk in that case.
 * The fallback is resolved from `process.cwd()` (npm/nitro run this workspace's scripts with cwd
 * `apps/api`), not `import.meta.url` -- nitro dev's bundler re-nests this module at an
 * unpredictable depth, so a URL-relative path resolves to the wrong directory. A disk path is
 * only ever a dev convenience: it would not survive the Vercel bundle, so it is never the primary
 * source, and production always resolves fonts through nitro's bundled assets above.
 */
const diskFallback = diskFontSource(path.resolve(process.cwd(), '../../packages/core/src/fonts/files'))
const nitroFontSource: FontSource = async (name) => {
  const raw = await useStorage('assets:fonts').getItemRaw<Buffer | Uint8Array>(name)
  if (raw) return new Uint8Array(raw)
  return diskFallback(name)
}
let fontsPromise: Promise<Awaited<ReturnType<typeof loadFonts>>> | null = null
// Memoised once per process: steps.ts keys a WeakMap of parsed font metrics off the returned
// object's identity, so every call here must resolve to the SAME FontBytes instance. A rejection
// is NOT memoised -- a transient read failure would otherwise poison every later step in this
// process, since Workflow retries the step but this module would keep handing back the same
// rejected promise.
const fonts = () =>
  (fontsPromise ??= loadFonts(nitroFontSource).catch((err: unknown) => {
    fontsPromise = null
    throw err
  }))

export async function productionDeps(): Promise<Deps> {
  return { db, blobs, config, startJob: async (jobId) => { await start(generateJob, [jobId]) } }
}

export async function productionJobContext(): Promise<JobContext> {
  return { db, blobs, fonts }
}
