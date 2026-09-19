import { z } from 'zod'
import type { FileId, PageSize, StoredFile, TemplateLayout, TemplateSlot, TemplateValues } from '@pdf-slot/core'

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
}) satisfies z.ZodType<TemplateSlot>

export const templateLayoutSchema = z.object({
  fileId: fileIdSchema,
  slots: z.array(templateSlotSchema),
  updatedAt: z.string(),
}) satisfies z.ZodType<TemplateLayout>

export const templateValuesSchema = z.object({
  fileId: fileIdSchema,
  values: z.record(z.string(), z.string()),
  updatedAt: z.string(),
}) satisfies z.ZodType<TemplateValues>

/** `StoredFile` without its bytes: what `GET /files/:id` returns; the bytes come from `/source`. */
export const fileMetaSchema = z.object({
  fileId: fileIdSchema,
  name: z.string().min(1),
  pages: z.array(pageSizeSchema).min(1),
  createdAt: z.string(),
})
export type FileMeta = z.infer<typeof fileMetaSchema>
export type _FileMetaMatchesCore = FileMeta extends Omit<StoredFile, 'source'> ? true : never

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
export const jobRecordSchema = z.record(z.string(), z.string())
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
