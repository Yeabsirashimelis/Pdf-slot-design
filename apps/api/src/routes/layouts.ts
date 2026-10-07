import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { templateLayoutSchema, templateValuesSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { getFileMeta } from '../db/files.js'
import { getLayout, getValues, hasDuplicateSlotNames, putLayout, putValues } from '../db/layouts.js'
import { fileIdParam } from './files.js'

const invalid = () => new ApiError(400, 'invalid_request', 'Invalid body')
const validate = <T extends typeof templateLayoutSchema | typeof templateValuesSchema>(schema: T) =>
  zValidator('json', schema, (result) => { if (!result.success) throw invalid() })

export const layoutsRoutes = new Hono<AppEnv>()

layoutsRoutes.get('/files/:id/layout', async (c) => {
  const layout = await getLayout(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!layout) throw notFound('Layout')
  return c.json(layout)
})

layoutsRoutes.put('/files/:id/layout', validate(templateLayoutSchema), async (c) => {
  const { db } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const layout = c.req.valid('json')
  if (layout.fileId !== fileId) throw invalid()
  if (!(await getFileMeta(db, fileId))) throw notFound('File')
  const dup = hasDuplicateSlotNames(layout.slots)
  if (dup !== null) throw new ApiError(409, 'duplicate_slot_name', `Two slots are named "${dup}"`)
  await putLayout(db, layout)
  return c.body(null, 204)
})

layoutsRoutes.get('/files/:id/values', async (c) => {
  const values = await getValues(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!values) throw notFound('Values')
  return c.json(values)
})

layoutsRoutes.put('/files/:id/values', validate(templateValuesSchema), async (c) => {
  const { db } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const values = c.req.valid('json')
  if (values.fileId !== fileId) throw invalid()
  if (!(await getFileMeta(db, fileId))) throw notFound('File')
  await putValues(db, values)
  return c.body(null, 204)
})
