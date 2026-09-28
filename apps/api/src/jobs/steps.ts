import { createFontMetrics, describeUnsupportedCharacters, findUnsupportedSlots, normalizePdf, renderPdf, toSlots, type EditorDocument, type FontBytes, type FontId, type FontMetrics, type TemplateLayout } from '@pdf-slot/core'
import { JOB_BATCH_SIZE } from '@pdf-slot/contracts'
import { FatalError } from 'workflow'
import { readAll } from '../blob/blobStore.js'
import { getFileMeta } from '../db/files.js'
import { getLayout } from '../db/layouts.js'
import { getJobItems, getJobRow, listDoneItemPaths, markItem, setJobStatus } from '../db/jobs.js'
import { getJobContext } from './context.js'
import { itemFileName, itemPath, recordToValues, zipPath } from './records.js'
import { zipStream } from './zip.js'

/** Metrics are parsed from the font bytes once per process, not once per PDF. */
const metricsCache = new WeakMap<FontBytes, Record<FontId, FontMetrics>>()
function metricsFor(fonts: FontBytes): (id: FontId) => FontMetrics {
  let table = metricsCache.get(fonts)
  if (!table) {
    table = Object.fromEntries(Object.entries(fonts).map(([id, bytes]) => [id, createFontMetrics(bytes)])) as Record<FontId, FontMetrics>
    metricsCache.set(fonts, table)
  }
  return (id) => table![id]
}

export async function loadJob(jobId: string): Promise<{ batches: number[][] }> {
  'use step'
  const { db } = await getJobContext()
  const row = await getJobRow(db, jobId)
  if (!row) throw new FatalError(`Job ${jobId} does not exist`)
  await setJobStatus(db, jobId, { status: 'running' })
  const batches: number[][] = []
  for (let i = 0; i < row.total; i += JOB_BATCH_SIZE) batches.push(Array.from({ length: Math.min(JOB_BATCH_SIZE, row.total - i) }, (_, j) => i + j))
  return { batches }
}

async function loadTemplate(jobId: string): Promise<{ doc: EditorDocument; layout: TemplateLayout }> {
  const { db, blobs } = await getJobContext()
  const row = await getJobRow(db, jobId)
  if (!row) throw new FatalError(`Job ${jobId} does not exist`)
  const [file, layout] = await Promise.all([getFileMeta(db, row.fileId), getLayout(db, row.fileId)])
  if (!file || !layout) throw new FatalError(`File or layout for job ${jobId} is gone`)
  const object = await blobs.get(file.blobPath)
  if (!object) throw new FatalError(`Source bytes for ${row.fileId} are gone`)
  return { doc: await normalizePdf(await readAll(object.stream), row.fileId), layout }
}

export async function renderBatch(jobId: string, indices: number[]): Promise<void> {
  'use step'
  const ctx = await getJobContext()
  const [{ doc, layout }, fonts, items] = await Promise.all([loadTemplate(jobId), ctx.fonts(), getJobItems(ctx.db, jobId, indices)])
  const metrics = metricsFor(fonts)
  for (const { index, record, status } of items) {
    // A Workflow retry re-runs renderBatch from the top with the same indices; items this call (or an
    // earlier attempt at it) already finished must not be re-rendered or re-marked.
    if (status !== 'pending') continue
    const slots = toSlots(layout, { fileId: layout.fileId, updatedAt: layout.updatedAt, values: recordToValues(layout, record) })
    const unsupported = findUnsupportedSlots(slots, metrics)
    if (unsupported.length > 0) {
      const names = unsupported.map((u) => `${layout.slots.find((s) => s.id === u.slotId)?.name ?? u.slotId}: ${describeUnsupportedCharacters(u.characters)}`)
      await markItem(ctx.db, jobId, index, { status: 'failed', error: `Characters the font cannot draw -- ${names.join('; ')}` })
      continue
    }
    try {
      const bytes = await renderPdf(doc, slots, fonts)
      await ctx.blobs.put(itemPath(jobId, index), bytes, 'application/pdf')
      await markItem(ctx.db, jobId, index, { status: 'done', pdfPath: itemPath(jobId, index) })
    } catch (err) {
      await markItem(ctx.db, jobId, index, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
}

export async function finishJob(jobId: string): Promise<void> {
  'use step'
  const { db, blobs } = await getJobContext()
  const done = await listDoneItemPaths(db, jobId)
  if (done.length === 0) {
    await setJobStatus(db, jobId, { status: 'failed', error: 'No record could be rendered', finishedAt: new Date() })
    return
  }
  async function* entries() {
    for (const { index, pdfPath } of done) {
      const object = await blobs.get(pdfPath)
      if (object) yield { name: itemFileName(index), bytes: await readAll(object.stream) }
    }
  }
  await blobs.put(zipPath(jobId), zipStream(entries()), 'application/zip')
  await setJobStatus(db, jobId, { status: 'done', zipPath: zipPath(jobId), finishedAt: new Date() })
}
