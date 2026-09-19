import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, twoPagePdf } from './helpers/fixtures.js'

describe('/files', () => {
  it('PUT stores meta and bytes; GET returns meta; /source streams the same bytes', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    const bytes = await twoPagePdf()
    expect((await putTestFile(app, FILE_ID, bytes)).status).toBe(204)
    const meta = await (await app.request(`/files/${FILE_ID}`)).json()
    expect(meta).toEqual({ fileId: FILE_ID, name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], createdAt: '2026-09-19T00:00:00.000Z' })
    const src = await app.request(`/files/${FILE_ID}/source`)
    expect(src.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await src.arrayBuffer())).toEqual(bytes)
    expect((await (await app.request('/files')).json())[0]).toMatchObject({ fileId: FILE_ID, pageCount: 2, slotCount: 0 })
  })
  it('validates the id and the meta', async () => {
    const app = createApp(await testDeps())
    expect((await app.request('/files/not-an-id')).status).toBe(400)
    const form = new FormData()
    form.set('meta', JSON.stringify({ name: '' }))
    form.set('source', new Blob([1, 2, 3].map((n) => new Uint8Array([n]))), 'x.pdf')
    const res = await app.request(`/files/${FILE_ID}`, { method: 'PUT', body: form })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_request')
  })
  it('404 for unknown files; DELETE removes row and blob', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    expect((await app.request(`/files/${FILE_ID}`)).status).toBe(404)
    expect((await app.request(`/files/${FILE_ID}/source`)).status).toBe(404)
    await putTestFile(app)
    expect((await app.request(`/files/${FILE_ID}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/files/${FILE_ID}`)).status).toBe(404)
    expect((deps.blobs as ReturnType<typeof import('../src/blob/memoryBlobStore.js').createMemoryBlobStore>).paths()).toEqual([])
    expect((await app.request(`/files/${FILE_ID}`, { method: 'DELETE' })).status).toBe(404)
  })
})
