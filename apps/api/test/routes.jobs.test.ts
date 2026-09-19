import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, slot } from './helpers/fixtures.js'
import { setJobStatus } from '../src/db/jobs.js'

const auth = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }
const post = (body: unknown, headers: Record<string, string> = auth) => ({ method: 'POST', headers, body: JSON.stringify(body) })

async function withLayout(app: ReturnType<typeof createApp>) {
  await putTestFile(app)
  await app.request(`/files/${FILE_ID}/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: FILE_ID, updatedAt: 't', slots: [slot()] }) })
}

describe('jobs routes', () => {
  it('needs the API key', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }, { 'Content-Type': 'application/json' }))).status).toBe(401)
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }, { ...auth, Authorization: 'Bearer wrong' }))).status).toBe(401)
  })
  it('creates a job, starts the workflow, and reports status', async () => {
    const startJob = vi.fn(async () => {})
    const deps = await testDeps({ startJob })
    const app = createApp(deps)
    await withLayout(app)
    const res = await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }, { Name: 'B' }] }))
    expect(res.status).toBe(202)
    const { jobId } = await res.json()
    expect(startJob).toHaveBeenCalledWith(jobId)
    expect(await (await app.request(`/jobs/${jobId}`)).json()).toMatchObject({ id: jobId, fileId: FILE_ID, status: 'queued', total: 2, items: [{ index: 0, status: 'pending' }, { index: 1, status: 'pending' }] })
  })
  it('400 without a layout or with no records; 404 for an unknown file or job', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))).status).toBe(404)
    await putTestFile(app)
    const noLayout = await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))
    expect(noLayout.status).toBe(400)
    expect((await noLayout.json()).error.code).toBe('no_layout')
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [] }))).status).toBe(400)
    expect((await app.request('/jobs/nope')).status).toBe(404)
  })
  it('the zip is only available once the job is done', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    await withLayout(app)
    const { jobId } = await (await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))).json()
    expect((await app.request(`/jobs/${jobId}/zip`)).status).toBe(409)
    await deps.blobs.put(`jobs/${jobId}/all.zip`, new Uint8Array([80, 75]), 'application/zip')
    await setJobStatus(deps.db, jobId, { status: 'done', zipPath: `jobs/${jobId}/all.zip`, finishedAt: new Date() })
    const zip = await app.request(`/jobs/${jobId}/zip`)
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toBe('application/zip')
    expect(zip.headers.get('content-disposition')).toBe(`attachment; filename="${jobId}.zip"`)
    expect(Array.from(new Uint8Array(await zip.arrayBuffer()))).toEqual([80, 75])
  })
})
