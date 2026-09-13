import { toast } from 'sonner'
import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from './templateStore'

const DB_NAME = 'pdf-slot-editor'
// v1 held a single `session` record (document bytes + slots). v2 keys
// everything by file id; the v1 record is dropped, not migrated -- the
// single-session model it served is gone.
const DB_VERSION = 2
const STORES = ['files', 'layouts', 'values', 'session'] as const
type StoreName = (typeof STORES)[number]
const SESSION_KEY = 'current'

let hasWarned = false
function warnUnavailable(): void {
  if (hasWarned) return
  hasWarned = true
  toast.warning("Your changes won't be saved between visits", {
    description:
      'Storage is unavailable in this browser (private browsing, or storage is blocked). You can still edit and download normally.',
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    request.onupgradeneeded = (event) => {
      const db = request.result
      // Reset by version, not by name: v1's only store happened to be
      // named `session` too, but it held a different shape (a single
      // {id, source, pages, slots} record keyed 'current'). Matching on
      // the name would let that stale v1 record survive into v2 and come
      // back out of SessionStore.get() cast as an OpenSession. Any
      // upgrade from before v2 wipes every existing store and rebuilds
      // the v2 set from scratch -- v1 data is discarded by design, not
      // migrated.
      if (event.oldVersion < 2) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
      }
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB open request was blocked'))
  })
}

async function read<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    const db = await openDatabase()
    try {
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
        req.onerror = () => reject(req.error ?? new Error('Failed to read'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    } finally {
      db.close()
    }
  } catch (err) {
    console.error(`Failed to read ${store}/${key}`, err)
    return null
  }
}

async function write(store: StoreName, key: string, value: unknown | undefined): Promise<void> {
  try {
    const db = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite')
        if (value === undefined) tx.objectStore(store).delete(key)
        else tx.objectStore(store).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    } finally {
      db.close()
    }
  } catch (err) {
    warnUnavailable()
    console.error(`Failed to write ${store}/${key}`, err)
  }
}

export class IndexedDbTemplateStore implements TemplateStore, SessionStore {
  getFile(fileId: FileId): Promise<StoredFile | null> {
    return read<StoredFile>('files', fileId)
  }
  putFile(file: StoredFile): Promise<void> {
    // Copy the bytes: IDB structured-clones anyway, but never hand a buffer
    // that pdf.js may later detach to anything that outlives this call.
    return write('files', file.fileId, { ...file, source: file.source.slice() })
  }
  getLayout(fileId: FileId): Promise<TemplateLayout | null> {
    return read<TemplateLayout>('layouts', fileId)
  }
  putLayout(layout: TemplateLayout): Promise<void> {
    return write('layouts', layout.fileId, layout)
  }
  getValues(fileId: FileId): Promise<TemplateValues | null> {
    return read<TemplateValues>('values', fileId)
  }
  putValues(values: TemplateValues): Promise<void> {
    return write('values', values.fileId, values)
  }
  get(): Promise<OpenSession | null> {
    return read<OpenSession>('session', SESSION_KEY)
  }
  put(session: OpenSession): Promise<void> {
    return write('session', SESSION_KEY, session)
  }
  clear(): Promise<void> {
    return write('session', SESSION_KEY, undefined)
  }
}

/** The app-wide instance; page.tsx and TemplateEditor take it as a prop so tests can pass their own. */
export const templateStore = new IndexedDbTemplateStore()
