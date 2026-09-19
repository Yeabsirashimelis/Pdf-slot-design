import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { zValidator } from '@hono/zod-validator'
import { createJobRequestSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { getFileMeta } from '../db/files.js'
import { getLayout } from '../db/layouts.js'
import { createJob, getJob, getJobRow } from '../db/jobs.js'
import { fileIdParam } from './files.js'

export const jobsRoutes = new Hono<AppEnv>()

jobsRoutes.post(
  '/files/:id/jobs',
  // The one endpoint that costs real compute: only callers holding the workspace key may start a job.
  // bearerAuth throws an HTTPException on failure; the shared error handler (errors.ts) wraps its 401
  // in our error envelope.
  async (c, next) => bearerAuth<AppEnv>({ token: c.get('deps').config.apiKey })(c, next),
  zValidator('json', createJobRequestSchema, (result) => {
    if (!result.success) throw new ApiError(400, 'invalid_request', 'records must be 1..5000 objects of strings')
  }),
  async (c) => {
    const { db, startJob } = c.get('deps')
    const fileId = fileIdParam(c.req.param('id'))
    if (!(await getFileMeta(db, fileId))) throw notFound('File')
    const layout = await getLayout(db, fileId)
    if (!layout || layout.slots.length === 0) throw new ApiError(400, 'no_layout', 'Lay out at least one slot before generating')
    const id = crypto.randomUUID()
    await createJob(db, { id, fileId, records: c.req.valid('json').records })
    await startJob(id)
    return c.json({ jobId: id }, 202)
  },
)

jobsRoutes.get('/jobs/:id', async (c) => {
  const job = await getJob(c.get('deps').db, c.req.param('id'))
  if (!job) throw notFound('Job')
  return c.json(job)
})

jobsRoutes.get('/jobs/:id/zip', async (c) => {
  const { db, blobs } = c.get('deps')
  const row = await getJobRow(db, c.req.param('id'))
  if (!row) throw notFound('Job')
  if (row.status !== 'done' || !row.zipPath) throw new ApiError(409, 'not_ready', 'The job has not finished')
  const object = await blobs.get(row.zipPath)
  if (!object) throw notFound('Zip')
  return c.body(object.stream, 200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${row.id}.zip"` })
})
