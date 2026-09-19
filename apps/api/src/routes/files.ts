import { Hono } from 'hono'
import { fileIdSchema, fileMetaSchema, putFileMetaSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { deleteFile, getFileMeta, listFiles, upsertFile } from '../db/files.js'
import { listJobBlobPathsForFile } from '../db/jobs.js'

export const sourcePath = (fileId: string) => `files/${fileId}.pdf`

/** Path param -> validated file id, or 400. */
export function fileIdParam(raw: string): string {
  const parsed = fileIdSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Invalid file id')
  return parsed.data
}

export const filesRoutes = new Hono<AppEnv>()

filesRoutes.get('/files', async (c) => c.json(await listFiles(c.get('deps').db)))

filesRoutes.get('/files/:id', async (c) => {
  const row = await getFileMeta(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!row) throw notFound('File')
  return c.json(fileMetaSchema.parse(row))
})

filesRoutes.get('/files/:id/source', async (c) => {
  const { db, blobs } = c.get('deps')
  const row = await getFileMeta(db, fileIdParam(c.req.param('id')))
  if (!row) throw notFound('File')
  const object = await blobs.get(row.blobPath)
  if (!object) throw notFound('File bytes')
  return c.body(object.stream, 200, { 'Content-Type': 'application/pdf' })
})

filesRoutes.put('/files/:id', async (c) => {
  const { db, blobs } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const body = await c.req.parseBody()
  const metaRaw = typeof body.meta === 'string' ? body.meta : ''
  let metaJson: unknown
  try { metaJson = JSON.parse(metaRaw) } catch { throw new ApiError(400, 'invalid_request', 'meta must be JSON') }
  const meta = putFileMetaSchema.safeParse(metaJson)
  if (!meta.success) throw new ApiError(400, 'invalid_request', 'Invalid file meta')
  const source = body.source
  if (!(source instanceof File)) throw new ApiError(400, 'invalid_request', 'source must be a file')
  const path = sourcePath(fileId)
  await blobs.put(path, new Uint8Array(await source.arrayBuffer()), 'application/pdf')
  await upsertFile(db, { fileId, ...meta.data, blobPath: path })
  return c.body(null, 204)
})

filesRoutes.delete('/files/:id', async (c) => {
  const { db, blobs } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  // Job output blobs first (the rows cascade with the file), then the file's own bytes.
  const jobPaths = await listJobBlobPathsForFile(db, fileId)
  const row = await deleteFile(db, fileId)
  if (!row) throw notFound('File')
  await blobs.delete([...jobPaths, row.blobPath])
  return c.body(null, 204)
})
