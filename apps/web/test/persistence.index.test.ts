import { describe, expect, it, vi } from 'vitest'
import { selectStores } from '@/lib/persistence/index'
import type { SessionStore, TemplateStore } from '@/lib/persistence/templateStore'

function fakeIdb(): TemplateStore & SessionStore {
  return {
    getFile: vi.fn(async () => null), putFile: vi.fn(async () => {}), getLayout: vi.fn(async () => null), putLayout: vi.fn(async () => {}),
    getValues: vi.fn(async () => null), putValues: vi.fn(async () => {}), listFiles: vi.fn(async () => []), deleteFile: vi.fn(async () => {}),
    get: vi.fn(async () => null), put: vi.fn(async () => {}), clear: vi.fn(async () => {}),
  }
}

describe('selectStores', () => {
  it('no API URL: IndexedDB for everything (today\'s behaviour)', () => {
    const idb = fakeIdb()
    const http = vi.fn()
    expect(selectStores({}, idb, http)).toBe(idb)
    expect(http).not.toHaveBeenCalled()
  })
  it('API URL set: HTTP for templates, IndexedDB for the session; deleting the open file clears the session', async () => {
    const idb = fakeIdb()
    const httpStore = { ...fakeIdb(), deleteFile: vi.fn(async () => {}) }
    const selected = selectStores({ apiUrl: 'http://api.test/' }, idb, () => httpStore)
    await selected.putLayout({ fileId: 'a', updatedAt: 't', slots: [] })
    expect(httpStore.putLayout).toHaveBeenCalled()
    await selected.put({ fileId: 'a', step: 'layout' })
    expect(idb.put).toHaveBeenCalled()
    ;(idb.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ fileId: 'a', step: 'layout' })
    await selected.deleteFile('a')
    expect(httpStore.deleteFile).toHaveBeenCalledWith('a')
    expect(idb.clear).toHaveBeenCalled()
  })
})
