import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Db } from './db/client.js'
import type { BlobStore } from './blob/blobStore.js'
import type { Config } from './config.js'
import { handleError } from './errors.js'
import { filesRoutes } from './routes/files.js'
import { layoutsRoutes } from './routes/layouts.js'
import { jobsRoutes } from './routes/jobs.js'

/** Everything a request handler needs, injected so tests run the app in-process against PGlite and an in-memory blob store. */
export type Deps = {
  db: Db
  blobs: BlobStore
  config: Pick<Config, 'apiKey' | 'webOrigin'>
  /** Starts the generation workflow for a job that has been inserted. */
  startJob(jobId: string): Promise<void>
}
export type AppEnv = { Variables: { deps: Deps } }

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use('*', cors({ origin: deps.config.webOrigin }))
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.get('/health', (c) => c.json({ ok: true }))
  app.route('/', filesRoutes)
  app.route('/', layoutsRoutes)
  app.route('/', jobsRoutes)
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
  app.onError(handleError)
  return app
}
