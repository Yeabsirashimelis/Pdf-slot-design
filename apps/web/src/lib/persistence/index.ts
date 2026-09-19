import type { SessionStore, TemplateStore } from './templateStore'
import { templateStore as indexedDb } from './indexedDbTemplateStore'
import { createHttpTemplateStore } from './httpTemplateStore'

/**
 * Which storage the app talks to. With an API URL, files/layouts/values go
 * to the server and only the open session (which file, which step -- a
 * per-device fact) stays in this browser. Without one, everything is in
 * IndexedDB exactly as before, which is also what every test runs against.
 */
export function selectStores(
  env: { apiUrl?: string },
  idb: TemplateStore & SessionStore,
  http: (url: string) => TemplateStore,
): TemplateStore & SessionStore {
  if (!env.apiUrl) return idb
  const remote = http(env.apiUrl)
  return {
    ...remote,
    get: () => idb.get(),
    put: (s) => idb.put(s),
    clear: () => idb.clear(),
    async deleteFile(fileId) {
      await remote.deleteFile(fileId)
      if ((await idb.get())?.fileId === fileId) await idb.clear()
    },
  }
}

export const apiUrl = process.env.NEXT_PUBLIC_API_URL || undefined
export const templateStore = selectStores({ apiUrl }, indexedDb, createHttpTemplateStore)
