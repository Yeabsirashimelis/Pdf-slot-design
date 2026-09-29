import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { TemplateTable, PageSize, TemplateSlot } from '@pdf-slot/core'
import type { JobRecord } from '@pdf-slot/contracts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}

export const files = pgTable('files', {
  fileId: text('file_id').primaryKey(),
  name: text('name').notNull(),
  pages: jsonb('pages').$type<PageSize[]>().notNull(),
  /** Pathname in the blob store; bytes are never stored in Postgres. */
  blobPath: text('blob_path').notNull(),
  ...timestamps,
})

export const layouts = pgTable('layouts', {
  fileId: text('file_id').primaryKey().references(() => files.fileId, { onDelete: 'cascade' }),
  slots: jsonb('slots').$type<TemplateSlot[]>().notNull(),
  // Nullable: a layout saved before tables existed simply has none.
  tables: jsonb('tables').$type<TemplateTable[]>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const values = pgTable('values', {
  fileId: text('file_id').primaryKey().references(() => files.fileId, { onDelete: 'cascade' }),
  values: jsonb('values').$type<Record<string, string>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull().references(() => files.fileId, { onDelete: 'cascade' }),
  status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull(),
  total: integer('total').notNull(),
  done: integer('done').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  error: text('error'),
  zipPath: text('zip_path'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /**
   * Whether a slot the record leaves out prints what was typed into it in
   * the editor, or prints blank. Kept on the job, not read from a setting
   * at render time: a job that starts today must print the same thing if
   * a step is retried tomorrow.
   */
  fillFromTemplate: boolean('fill_from_template').notNull().default(false),
  ...timestamps,
})

export const jobItems = pgTable('job_items', {
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  record: jsonb('record').$type<JobRecord>().notNull(),
  status: text('status').$type<'pending' | 'done' | 'failed'>().notNull().default('pending'),
  pdfPath: text('pdf_path'),
  error: text('error'),
}, (t) => [primaryKey({ columns: [t.jobId, t.index] })])

export const schema = { files, layouts, values, jobs, jobItems }
