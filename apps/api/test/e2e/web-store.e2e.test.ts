// Installs a global IndexedDB before any web module can look for one.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPdf, toSlots, type TemplateLayout } from '@pdf-slot/core'
import { openFile } from '@/features/template/openFile'
import { selectStores } from '@/lib/persistence'
import { createHttpTemplateStore } from '@/lib/persistence/httpTemplateStore'
import { templateStore as idb } from '@/lib/persistence/indexedDbTemplateStore'
import { FILE_ID, slot, twoPagePdf } from '../helpers/fixtures.js'
import { API_URL, bootApi, fonts } from './helpers.js'

const UPDATED_AT = '2026-09-19T00:00:00.000Z'
const CREATED_AT = '2026-09-19T00:00:00.000Z'
const PAGES = [{ width: 612, height: 792 }, { width: 612, height: 792 }]

const oneSlotLayout = (fileId: string): TemplateLayout => ({ fileId, updatedAt: UPDATED_AT, slots: [slot()] as TemplateLayout['slots'] })

/** The IndexedDB store keeps one database per origin; every case starts from an empty one. */
function dropIndexedDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('pdf-slot-editor')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => reject(new Error('deleteDatabase was blocked by an open connection'))
  })
}

describe('web persistence end to end: the real store code against the real API, and the IndexedDB fallback', () => {
  beforeEach(dropIndexedDb)
  afterEach(() => vi.unstubAllGlobals())

  it('the HTTP store round-trips file, layout and values through the API and forgets a deleted file', async () => {
    const api = await bootApi()
    vi.stubGlobal('fetch', api.fetchViaApp)
    const store = createHttpTemplateStore(API_URL)

    const source = await twoPagePdf()
    await store.putFile({ fileId: FILE_ID, name: 'form.pdf', pages: PAGES, createdAt: CREATED_AT, source })
    const file = await store.getFile(FILE_ID)
    expect(file).toMatchObject({ fileId: FILE_ID, name: 'form.pdf', pages: PAGES, createdAt: CREATED_AT })
    expect(file!.source).toEqual(source)

    const layout = oneSlotLayout(FILE_ID)
    await store.putLayout(layout)
    expect(await store.getLayout(FILE_ID)).toEqual(layout)

    const values = { fileId: FILE_ID, updatedAt: UPDATED_AT, values: { s1: 'Hello' } }
    await store.putValues(values)
    expect(await store.getValues(FILE_ID)).toEqual(values)

    expect(await store.listFiles()).toEqual([{ fileId: FILE_ID, name: 'form.pdf', pageCount: 2, slotCount: 1, updatedAt: UPDATED_AT }])

    await store.deleteFile(FILE_ID)
    expect(await store.getFile(FILE_ID)).toBeNull()
    expect(await store.getLayout(FILE_ID)).toBeNull()
    expect(await store.getValues(FILE_ID)).toBeNull()
    expect(await store.listFiles()).toEqual([])
    expect(api.deps.blobs.paths()).toEqual([])
  })

  it('openFile lands in the right step from the server, and recognises a filled copy by its stamp', async () => {
    const api = await bootApi()
    vi.stubGlobal('fetch', api.fetchViaApp)
    const store = createHttpTemplateStore(API_URL)
    const bytes = await twoPagePdf()

    // Never seen before: the layout step, and the bytes are now on the server.
    const first = await openFile(bytes, 'form.pdf', store)
    expect(first.step).toBe('layout')
    expect(first.layout).toBeNull()
    expect(first.values).toBeNull()
    expect(first.fileId).toMatch(/^[0-9a-f]{64}$/)
    expect((await store.listFiles()).map((f) => [f.fileId, f.name, f.pageCount, f.slotCount])).toEqual([[first.fileId, 'form.pdf', 2, 0]])
    expect(api.deps.blobs.paths()).toEqual([`files/${first.fileId}.pdf`])

    // Laid out on the server: the same bytes open in the write step.
    const layout = oneSlotLayout(first.fileId)
    await store.putLayout(layout)
    const second = await openFile(bytes, 'form.pdf', store)
    expect(second.fileId).toBe(first.fileId)
    expect(second.step).toBe('write')
    expect(second.layout?.slots).toHaveLength(1)

    // A filled export has different bytes but carries the source stamp: still the same file, still the write step,
    // and the editor opens the stored original, not the filled copy.
    const filled = await renderPdf(second.doc, toSlots(layout, { fileId: first.fileId, updatedAt: UPDATED_AT, values: { s1: 'Abel' } }), fonts)
    expect(filled).not.toEqual(bytes)
    const third = await openFile(filled, 'form-filled.pdf', store)
    expect(third.fileId).toBe(first.fileId)
    expect(third.step).toBe('write')
    expect(third.name).toBe('form.pdf')
    expect(third.doc.source).toEqual(bytes)
    expect((await store.listFiles()).map((f) => f.fileId)).toEqual([first.fileId])
  })

  it('without an API URL the selected store is IndexedDB itself and nothing is fetched', async () => {
    const api = await bootApi()
    const fetchSpy = vi.fn(api.fetchViaApp)
    vi.stubGlobal('fetch', fetchSpy)
    const http = vi.fn(createHttpTemplateStore)

    const store = selectStores({}, idb, http)
    expect(store).toBe(idb)
    expect(http).not.toHaveBeenCalled()

    const bytes = await twoPagePdf()
    const first = await openFile(bytes, 'form.pdf', store)
    expect(first.step).toBe('layout')
    expect(first.layout).toBeNull()

    await store.putLayout(oneSlotLayout(first.fileId))
    const second = await openFile(bytes, 'form.pdf', store)
    expect(second.fileId).toBe(first.fileId)
    expect(second.step).toBe('write')
    expect(second.layout?.slots).toHaveLength(1)
    expect((await store.listFiles()).map((f) => [f.name, f.slotCount])).toEqual([['form.pdf', 1]])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(api.deps.blobs.paths()).toEqual([])
    expect(await (await api.app.request('/files')).json()).toEqual([])
  })

  it('with an API URL the file and layout go to the server while the open session stays in IndexedDB', async () => {
    const api = await bootApi()
    const fetchSpy = vi.fn(api.fetchViaApp)
    vi.stubGlobal('fetch', fetchSpy)
    const store = selectStores({ apiUrl: API_URL }, idb, createHttpTemplateStore)
    const remote = createHttpTemplateStore(API_URL)

    const bytes = await twoPagePdf()
    const opened = await openFile(bytes, 'form.pdf', store)
    const layout = oneSlotLayout(opened.fileId)
    await store.putLayout(layout)
    expect(await remote.getLayout(opened.fileId)).toEqual(layout)
    expect((await remote.getFile(opened.fileId))?.source).toEqual(bytes)
    expect(await idb.getFile(opened.fileId)).toBeNull()
    expect(await idb.getLayout(opened.fileId)).toBeNull()

    const fetches = fetchSpy.mock.calls.length
    await store.put({ fileId: opened.fileId, step: 'write' })
    expect(await store.get()).toEqual({ fileId: opened.fileId, step: 'write' })
    expect(await idb.get()).toEqual({ fileId: opened.fileId, step: 'write' })
    expect(fetchSpy.mock.calls.length).toBe(fetches)

    await store.deleteFile(opened.fileId)
    expect(await store.get()).toBeNull()
    expect(await remote.getFile(opened.fileId)).toBeNull()
    expect(await remote.listFiles()).toEqual([])
    expect(api.deps.blobs.paths()).toEqual([])
  })
})
