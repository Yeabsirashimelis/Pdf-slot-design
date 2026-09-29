import { z } from 'zod'
import type { FileId, PageSize, StoredFile, TableStyle, TemplateLayout, TemplateSlot, TemplateTable, TemplateValues } from '@pdf-slot/core'

/** Request/response shapes shared by the API and the web client -- one source of truth, validated on both sides. */

export const MAX_JOB_RECORDS = 5000
export const JOB_BATCH_SIZE = 25

/** 64-hex SHA-256 (content hash) or 32-hex random id (see apps/web fileHash.ts). */
export const fileIdSchema = z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f]{32})$/)

export const fontIdSchema = z.enum(['sans', 'sans-bold', 'serif', 'serif-bold', 'mono'])
export const pageSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() })

export const templateSlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().min(0),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().min(0).optional(),
  fontId: fontIdSchema,
  size: z.number().positive(),
  color: z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1) }),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive(),
  padding: z.number().min(0).optional(),
}) satisfies z.ZodType<TemplateSlot>

/** The typography every cell of a table shares. */
export const tableStyleSchema = z.object({
  fontId: fontIdSchema,
  size: z.number().positive(),
  color: z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1) }),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive(),
  padding: z.number().min(0).optional(),
}) satisfies z.ZodType<TableStyle>

/**
 * A table row slot: one printed row described once and multiplied down
 * the page. Its cells are not stored -- they are worked out from the
 * columns and the row heights -- so this is the whole of it.
 */
export const templateTableSchema = z.object({
  id: z.string().min(1),
  /** What a data file calls this table; a record's rows are addressed by it. */
  name: z.string().min(1),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  columns: z.array(z.object({
    key: z.string().min(1),
    name: z.string(),
    width: z.number().positive(),
  })).min(1),
  rowHeights: z.array(z.number().positive()).min(1),
  style: tableStyleSchema,
}) satisfies z.ZodType<TemplateTable>

export const templateLayoutSchema = z.object({
  fileId: fileIdSchema,
  slots: z.array(templateSlotSchema),
  tables: z.array(templateTableSchema).optional(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<TemplateLayout>

export const templateValuesSchema = z.object({
  fileId: fileIdSchema,
  values: z.record(z.string(), z.string()),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<TemplateValues>

/** `StoredFile` without its bytes: what `GET /files/:id` returns; the bytes come from `/source`. */
export const fileMetaSchema = z.object({
  fileId: fileIdSchema,
  name: z.string().min(1),
  pages: z.array(pageSizeSchema).min(1),
  createdAt: z.iso.datetime(),
})
export type FileMeta = z.infer<typeof fileMetaSchema>
// Compile-time check that the wire shape is still core's `StoredFile` minus its bytes: if either side
// drifts, this assignment stops type-checking. A bare type alias would not -- an unused conditional
// type is never evaluated, so the mismatch would go unnoticed.
const _fileMetaMatchesCore: FileMeta extends Omit<StoredFile, 'source'> ? true : never = true
void _fileMetaMatchesCore

/** The multipart `meta` part of `PUT /files/:id` (the id is in the path). */
export const putFileMetaSchema = fileMetaSchema.omit({ fileId: true })

export const storedFileSummarySchema = z.object({
  fileId: fileIdSchema,
  name: z.string(),
  pageCount: z.number().int().min(0),
  slotCount: z.number().int().min(0),
  updatedAt: z.string(),
})
export type StoredFileSummary = z.infer<typeof storedFileSummarySchema>

/** One record per PDF: slot name -> text. Unknown keys are ignored, missing slots are left blank. */
/**
 * One record: one PDF.
 *
 * A key holding text names a slot. A key holding a list of rows names a
 * *table*, and the rows go down it -- which is why a record cannot be a
 * flat grid, and why a table can only be filled from JSON. A record may
 * carry either kind or both, and whatever matches the file is printed.
 */
export const jobTableRowsSchema = z.array(z.record(z.string(), z.string()))
export const jobRecordSchema = z.record(z.string(), z.union([z.string(), jobTableRowsSchema]))
export type JobTableRows = z.infer<typeof jobTableRowsSchema>
export type JobRecord = z.infer<typeof jobRecordSchema>

export const createJobRequestSchema = z.object({
  records: z.array(jobRecordSchema).min(1).max(MAX_JOB_RECORDS),
})
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>

export const jobItemStatusSchema = z.enum(['pending', 'done', 'failed'])
export const jobStatusValueSchema = z.enum(['queued', 'running', 'done', 'failed'])

export const jobItemSchema = z.object({
  index: z.number().int().min(0),
  status: jobItemStatusSchema,
  error: z.string().nullable(),
})
export const jobStatusSchema = z.object({
  id: z.string(),
  fileId: fileIdSchema,
  status: jobStatusValueSchema,
  total: z.number().int().min(0),
  done: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  items: z.array(jobItemSchema),
})
export type JobStatus = z.infer<typeof jobStatusSchema>
export type JobItem = z.infer<typeof jobItemSchema>

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export type { FileId }
