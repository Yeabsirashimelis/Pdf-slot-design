import { describe, expect, it } from 'vitest'
import { normalizePdf, renderPdf, toSlots, type TemplateLayout } from '@pdf-slot/core'
import type { JobStatus } from '@pdf-slot/contracts'
import { requireContentStreamText } from '../../../../packages/core/test/helpers/content-stream.js'
import { FILE_ID, putTestFile, slot, twoPagePdf } from '../helpers/fixtures.js'
import { API_KEY, bootApi, fonts, openZip, type BootedApi } from './helpers.js'

const UPDATED_AT = '2026-09-19T00:00:00.000Z'
const jsonHeaders = { 'Content-Type': 'application/json' }
const authHeaders = { ...jsonHeaders, Authorization: `Bearer ${API_KEY}` }

/** `Name` on page one in PT Sans, `Date` on page two in the mono face -- two pages, two fonts, one layout. */
const twoSlotLayout = (): TemplateLayout => ({
  fileId: FILE_ID,
  updatedAt: UPDATED_AT,
  slots: [slot(), slot({ id: 's2', name: 'Date', order: 1, page: 1, fontId: 'mono' })] as TemplateLayout['slots'],
})

const putJson = (api: BootedApi, path: string, body: unknown) =>
  api.app.request(path, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) })

const postJob = (api: BootedApi, records: Record<string, string>[], headers: Record<string, string> = authHeaders) =>
  api.app.request(`/files/${FILE_ID}/jobs`, { method: 'POST', headers, body: JSON.stringify({ records }) })

const getJob = async (api: BootedApi, jobId: string): Promise<JobStatus> => {
  const res = await api.app.request(`/jobs/${jobId}`)
  expect(res.status).toBe(200)
  return res.json()
}

/** File + two-slot layout on a fresh API; returns the source bytes so a test can compute what the output must be. */
async function seedTemplate(api: BootedApi): Promise<{ source: Uint8Array; layout: TemplateLayout }> {
  const source = await twoPagePdf()
  expect((await putTestFile(api.app, FILE_ID, source)).status).toBe(204)
  const layout = twoSlotLayout()
  expect((await putJson(api, `/files/${FILE_ID}/layout`, layout)).status).toBe(204)
  return { source, layout }
}

/** What the editor's own renderer produces for this record: the bulk output must show exactly this text. */
async function expectedPdf(source: Uint8Array, layout: TemplateLayout, values: Record<string, string>): Promise<Uint8Array> {
  const doc = await normalizePdf(source, FILE_ID)
  return renderPdf(doc, toSlots(layout, { fileId: FILE_ID, updatedAt: UPDATED_AT, values }), fonts)
}

describe('API end to end: upload -> layout -> values -> job -> generation -> zip', () => {
  it('generates one PDF per record, each identical in drawn text to the editor renderer, and the record beats the saved values', async () => {
    const api = await bootApi()
    const { source, layout } = await seedTemplate(api)
    // Saved single-fill values: bulk generation must ignore them in favour of each record.
    expect((await putJson(api, `/files/${FILE_ID}/values`, { fileId: FILE_ID, updatedAt: UPDATED_AT, values: { s1: 'Draft' } })).status).toBe(204)

    const records = [{ Name: 'Abel Tesfaye', Date: '18 Sep 2026' }, { Name: 'Sara Kim', Date: '19 Sep 2026' }]
    const created = await postJob(api, records)
    expect(created.status).toBe(202)
    const { jobId } = (await created.json()) as { jobId: string }
    expect(api.started).toEqual([jobId])

    const queued = await getJob(api, jobId)
    expect(queued).toMatchObject({ id: jobId, fileId: FILE_ID, status: 'queued', total: 2, done: 0, failed: 0, finishedAt: null })
    expect(queued.items).toEqual([{ index: 0, status: 'pending', error: null }, { index: 1, status: 'pending', error: null }])

    await api.runJob(jobId)

    const done = await getJob(api, jobId)
    expect(done).toMatchObject({ status: 'done', total: 2, done: 2, failed: 0, error: null })
    expect(done.finishedAt).toEqual(expect.any(String))
    expect(done.items.map((i) => i.status)).toEqual(['done', 'done'])

    const zipRes = await api.app.request(`/jobs/${jobId}/zip`)
    expect(zipRes.status).toBe(200)
    expect(zipRes.headers.get('content-type')).toBe('application/zip')
    expect(zipRes.headers.get('content-disposition')).toBe(`attachment; filename="${jobId}.zip"`)
    const zip = openZip(new Uint8Array(await zipRes.arrayBuffer()))
    expect(Object.keys(zip)).toEqual(['record-0001.pdf', 'record-0002.pdf'])

    for (const [i, record] of records.entries()) {
      const entry = zip[`record-${String(i + 1).padStart(4, '0')}.pdf`]!
      const fromRecord = await expectedPdf(source, layout, { s1: record.Name, s2: record.Date })
      expect(requireContentStreamText(entry)).toBe(requireContentStreamText(fromRecord))
      // Positive control for "the record wins": the same page filled with the saved 'Draft' value draws different text.
      const fromSavedValues = await expectedPdf(source, layout, { s1: 'Draft', s2: record.Date })
      expect(requireContentStreamText(entry)).not.toBe(requireContentStreamText(fromSavedValues))
    }
  })

  it('a record the font cannot draw fails only its own item; the zip holds the rest', async () => {
    const api = await bootApi()
    await seedTemplate(api)
    // `Name` is PT Sans, which has no CJK glyphs.
    const created = await postJob(api, [{ Name: 'ok' }, { Name: '中文' }])
    expect(created.status).toBe(202)
    const { jobId } = (await created.json()) as { jobId: string }

    await api.runJob(jobId)

    const job = await getJob(api, jobId)
    expect(job).toMatchObject({ status: 'done', total: 2, done: 1, failed: 1 })
    expect(job.items[0]).toEqual({ index: 0, status: 'done', error: null })
    expect(job.items[1]).toMatchObject({ index: 1, status: 'failed' })
    expect(job.items[1]!.error).toMatch(/Name/)

    const zipRes = await api.app.request(`/jobs/${jobId}/zip`)
    expect(zipRes.status).toBe(200)
    expect(Object.keys(openZip(new Uint8Array(await zipRes.arrayBuffer())))).toEqual(['record-0001.pdf'])
  })

  it('guards: no layout, wrong key, zip before done, duplicate slot names; deleting the file removes every blob and the job', async () => {
    const api = await bootApi()
    expect((await putTestFile(api.app)).status).toBe(204)

    const noLayout = await postJob(api, [{ Name: 'A' }])
    expect(noLayout.status).toBe(400)
    expect(await noLayout.json()).toEqual({ error: { code: 'no_layout', message: 'Lay out at least one slot before generating' } })

    const duplicate = await putJson(api, `/files/${FILE_ID}/layout`, {
      fileId: FILE_ID, updatedAt: UPDATED_AT, slots: [slot(), slot({ id: 's2', order: 1 })],
    })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: { code: 'duplicate_slot_name', message: 'Two slots are named "Name"' } })

    expect((await putJson(api, `/files/${FILE_ID}/layout`, twoSlotLayout())).status).toBe(204)

    const wrongKey = await postJob(api, [{ Name: 'A' }], { ...jsonHeaders, Authorization: 'Bearer wrong' })
    expect(wrongKey.status).toBe(401)
    expect(await wrongKey.json()).toEqual({ error: { code: 'unauthorized', message: 'Invalid or missing API key' } })
    expect(api.started).toEqual([])

    const created = await postJob(api, [{ Name: 'A', Date: 'B' }])
    expect(created.status).toBe(202)
    const { jobId } = (await created.json()) as { jobId: string }

    const early = await api.app.request(`/jobs/${jobId}/zip`)
    expect(early.status).toBe(409)
    expect(await early.json()).toEqual({ error: { code: 'not_ready', message: 'The job has not finished' } })

    await api.runJob(jobId)
    expect(await getJob(api, jobId)).toMatchObject({ status: 'done', done: 1 })
    expect(api.deps.blobs.paths().sort()).toEqual([`files/${FILE_ID}.pdf`, `jobs/${jobId}/all.zip`, `jobs/${jobId}/record-0001.pdf`])

    expect((await api.app.request(`/files/${FILE_ID}`, { method: 'DELETE' })).status).toBe(204)
    expect(api.deps.blobs.paths()).toEqual([])
    expect((await api.app.request(`/jobs/${jobId}`)).status).toBe(404)
    expect((await api.app.request(`/jobs/${jobId}/zip`)).status).toBe(404)
    expect((await api.app.request(`/files/${FILE_ID}`)).status).toBe(404)
  })
})
