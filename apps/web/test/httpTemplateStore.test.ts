import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the same spies survive `vi.resetModules()` below: a re-imported `sonner` gets these
// again, and the assertions here keep pointing at the functions the store actually calls.
const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const fileId = 'a'.repeat(64)
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('HttpTemplateStore', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let createHttpTemplateStore: typeof import('@/lib/persistence/httpTemplateStore')['createHttpTemplateStore']
  beforeEach(async () => {
    // The "unreachable" warning latches once per module instance, so each test gets a fresh
    // module: what one test provokes must not decide what the next one can observe.
    vi.resetModules()
    ;({ createHttpTemplateStore } = await import('@/lib/persistence/httpTemplateStore'))
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    toast.warning.mockClear()
    toast.error.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())
  const store = () => createHttpTemplateStore('http://api.test')

  it('getFile joins meta and bytes; null on 404', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }))
    const file = await store().getFile(fileId)
    expect(file).toEqual({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z', source: new Uint8Array([1, 2]) })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([`http://api.test/files/${fileId}`, `http://api.test/files/${fileId}/source`])
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'not_found', message: 'x' } }, 404))
    expect(await store().getFile(fileId)).toBeNull()
  })

  it('getFile resolves null (and warns once) when the source body read fails mid-stream', async () => {
    // The meta request and the source request both succeed; the failure is in reading the
    // second body -- a connection dropped after the headers arrived. The store's contract is
    // "never rejects", so this must read as "nothing saved", exactly like a failed fetch.
    fetchMock
      .mockResolvedValueOnce(okJson({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z' }))
      .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: () => Promise.reject(new TypeError('network error')) } as unknown as Response)
    await expect(store().getFile(fileId)).resolves.toBeNull()
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('putFile sends multipart meta + source', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().putFile({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z', source: new Uint8Array([9]) })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/files/${fileId}`)
    expect(init?.method).toBe('PUT')
    const form = init?.body as FormData
    expect(JSON.parse(form.get('meta') as string)).toEqual({ name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z' })
    expect((form.get('source') as File).size).toBe(1)
  })

  it('a 413 on putFile tells the user the PDF is too large for the server and drops the write', async () => {
    // The platform, not our API, answers a 413 -- with a plain-text body, never our envelope --
    // so the generic "Request failed (413)" would leave the user guessing. They can keep working:
    // the editor and the download never needed the server.
    fetchMock.mockResolvedValueOnce(new Response('Request Entity Too Large', { status: 413 }))
    await expect(store().putFile({ fileId, name: 'big.pdf', pages: [{ width: 1, height: 1 }], createdAt: '2026-09-19T00:00:00.000Z', source: new Uint8Array([9]) })).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('This PDF is too large to save on the server (limit 4.5 MB). You can still edit and download it.')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('a 409 that parses as our error envelope is shown with its own reason, not the unreachable warning, and resolves', async () => {
    const layout = { fileId, updatedAt: '2024-01-01T00:00:00.000Z', slots: [] }
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'duplicate_slot_name', message: 'Two slots are named "Name"' } }, 409))
    await expect(store().putLayout(layout)).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith('Two slots are named "Name"')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('a 500 warns unreachable once and never calls toast.error', async () => {
    const layout = { fileId, updatedAt: '2024-01-01T00:00:00.000Z', slots: [] }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await store().putLayout(layout)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('two consecutive 409s each show their own reason -- the error toast is not latched', async () => {
    const layout = { fileId, updatedAt: '2024-01-01T00:00:00.000Z', slots: [] }
    fetchMock
      .mockResolvedValueOnce(okJson({ error: { code: 'duplicate_slot_name', message: 'first' } }, 409))
      .mockResolvedValueOnce(okJson({ error: { code: 'duplicate_slot_name', message: 'second' } }, 409))
    await store().putLayout(layout)
    await store().putLayout(layout)
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenNthCalledWith(1, 'first')
    expect(toast.error).toHaveBeenNthCalledWith(2, 'second')
  })

  it('layout/values/list/delete map to their routes; a network failure never rejects', async () => {
    // `templateLayoutSchema.updatedAt` is `z.iso.datetime()` in @pdf-slot/contracts (fix(api):
    // reject non-ISO timestamps at the boundary), so the fixture used for the `getLayout`
    // round-trip must be a real ISO datetime, not the 't' placeholder used elsewhere in this
    // file for fields the schema doesn't validate as datetimes.
    const layout = { fileId, updatedAt: '2024-01-01T00:00:00.000Z', slots: [] }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().putLayout(layout)
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('PUT')
    fetchMock.mockResolvedValueOnce(okJson(layout))
    expect(await store().getLayout(fileId)).toEqual(layout)
    fetchMock.mockResolvedValueOnce(okJson([{ fileId, name: 'a.pdf', pageCount: 1, slotCount: 0, updatedAt: 't' }]))
    expect((await store().listFiles())[0]?.name).toBe('a.pdf')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().deleteFile(fileId)
    expect(fetchMock.mock.calls.at(-1)![1]?.method).toBe('DELETE')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(store().getValues(fileId)).resolves.toBeNull()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(store().putValues({ fileId, updatedAt: 't', values: {} })).resolves.toBeUndefined()
  })
})
