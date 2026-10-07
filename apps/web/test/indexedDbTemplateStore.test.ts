import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'

const file: StoredFile = {
  fileId: 'f1', name: 'form.pdf', source: new Uint8Array([1, 2, 3]),
  pages: [{ width: 612, height: 792 }], createdAt: '2026-09-13T00:00:00.000Z',
}
const layout: TemplateLayout = {
  fileId: 'f1', updatedAt: '2026-09-13T00:00:00.000Z',
  slots: [{ id: 's1', name: 'CO#', order: 0, page: 0, x: 1, y: 2, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 }],
}
const values: TemplateValues = { fileId: 'f1', updatedAt: '2026-09-13T00:00:00.000Z', values: { s1: '001' } }

describe('IndexedDbTemplateStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('round-trips file, layout and values by fileId, and reads null for unknown ids', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    expect(await store.getFile('f1')).toBeNull()
    await store.putFile(file)
    await store.putLayout(layout)
    await store.putValues(values)
    expect(Array.from((await store.getFile('f1'))!.source)).toEqual([1, 2, 3])
    expect(await store.getLayout('f1')).toEqual(layout)
    expect(await store.getValues('f1')).toEqual(values)
    expect(await store.getLayout('nope')).toBeNull()
  })

  it('a later put replaces the earlier one', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putValues(values)
    await store.putValues({ ...values, values: { s1: '002' } })
    expect((await store.getValues('f1'))!.values).toEqual({ s1: '002' })
  })

  it('remembers and clears the open session', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    expect(await store.get()).toBeNull()
    await store.put({ fileId: 'f1' })
    expect(await store.get()).toEqual({ fileId: 'f1' })
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it('upgrading from the v1 database drops the old single-session store', async () => {
    // Create a v1 database the way the previous release did, and seed it
    // with a v1-shaped record under the same key the v2 SessionStore reads
    // ('current') -- this is what the fix must not let leak through.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('pdf-slot-editor', 1)
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('session')
        store.put({ id: 'x', source: new Uint8Array([1]), pages: [], slots: [] }, 'current')
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putLayout(layout)
    const names = await new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open('pdf-slot-editor')
      req.onsuccess = () => { resolve(Array.from(req.result.objectStoreNames)); req.result.close() }
      req.onerror = () => reject(req.error)
    })
    expect(names.sort()).toEqual(['files', 'layouts', 'session', 'values'])
    expect(await store.get()).toBeNull()
  })

  it('never rejects when IndexedDB is unavailable; reads are null and one warning is shown', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const sonner = await import('sonner')
    const warn = vi.spyOn(sonner.toast, 'warning')
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await expect(store.putLayout(layout)).resolves.toBeUndefined()
    await expect(store.putValues(values)).resolves.toBeUndefined()
    expect(await store.getLayout('f1')).toBeNull()
    expect(await store.get()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('lists saved files with their slot count and last edit, newest first', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putFile(file)
    await store.putFile({ ...file, fileId: 'f2', name: 'other.pdf', createdAt: '2026-09-14T00:00:00.000Z' })
    await store.putLayout(layout)
    const list = await store.listFiles()
    expect(list.map((f) => [f.fileId, f.name, f.pageCount, f.slotCount, f.updatedAt])).toEqual([
      ['f2', 'other.pdf', 1, 0, '2026-09-14T00:00:00.000Z'],
      ['f1', 'form.pdf', 1, 1, '2026-09-13T00:00:00.000Z'],
    ])
    // Summaries never carry the bytes.
    expect('source' in list[0]!).toBe(false)
  })

  it('deleteFile removes the file, its layout and values, and the session if it was open', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putFile(file)
    await store.putLayout(layout)
    await store.putValues(values)
    await store.put({ fileId: 'f1' })
    await store.deleteFile('f1')
    expect(await store.getFile('f1')).toBeNull()
    expect(await store.getLayout('f1')).toBeNull()
    expect(await store.getValues('f1')).toBeNull()
    expect(await store.get()).toBeNull()
    expect(await store.listFiles()).toEqual([])
  })

  it('deleteFile leaves another open session alone', async () => {
    const { IndexedDbTemplateStore } = await import('../src/lib/persistence/indexedDbTemplateStore')
    const store = new IndexedDbTemplateStore()
    await store.putFile(file)
    await store.put({ fileId: 'other' })
    await store.deleteFile('f1')
    expect(await store.get()).toEqual({ fileId: 'other' })
  })
})
