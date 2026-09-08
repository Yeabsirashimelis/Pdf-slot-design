import { toast } from 'sonner'
import type { EditorDocument, PageSize, Slot } from '@pdf-slot/core'

const DB_NAME = 'pdf-slot-editor'
const DB_VERSION = 1
const STORE_NAME = 'session'
/** One object store, one key: this app only ever persists a single, current session. */
const SESSION_KEY = 'current'

type StoredSession = {
  id: string
  source: Uint8Array
  pages: PageSize[]
  slots: Slot[]
}

/**
 * Shown at most once per page load. Private browsing, a full quota, and
 * storage disabled by policy are all normal and must never repeat-nag the
 * user on every failed write during a session.
 */
let hasWarned = false

function warnUnavailable(): void {
  if (hasWarned) return
  hasWarned = true
  toast.warning("Your changes won't be saved between visits", {
    description: 'Storage is unavailable in this browser (private browsing, or storage is blocked). You can still edit and download normally.',
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
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB open request was blocked'))
  })
}

/** Runs a write-only transaction (put/delete): resolves once it commits. */
function runWrite(db: IDBDatabase, run: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    run(tx.objectStore(STORE_NAME))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/** Reads the one session record, or undefined if none was ever written. */
function readRecord(db: IDBDatabase): Promise<StoredSession | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(SESSION_KEY)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    request.onerror = () => reject(request.error ?? new Error('Failed to read session'))
    request.onsuccess = () => resolve(request.result as StoredSession | undefined)
  })
}

/**
 * Persist the document bytes and slots. Debouncing is the caller's concern
 * (Editor.tsx schedules this ~1s after the last slot change) so this
 * function itself stays a plain, directly-testable write.
 *
 * `doc.source` is copied with `.slice()` before it goes anywhere near
 * IndexedDB. This is defence-in-depth, not the thing actually preventing a
 * detached-buffer write -- `IDBObjectStore.put()` performs its own
 * structured clone of its argument at write time (per the IndexedDB spec),
 * so the record it stores is already an independent copy regardless of
 * whether this `.slice()` runs. (Confirmed empirically: removing it still
 * leaves indexeddb.test.ts's round-trip test green -- see task-18-report.md's
 * fix-round-1 entry. Do not read that test as proof this line is load-bearing.)
 *
 * The property that actually matters -- doc.source is never a detached
 * buffer *at the moment this function reads it* -- comes from upstream: the
 * only place `EditorDocument.source` is ever handed to something that
 * transfers/detaches ArrayBuffers is pdf.js's `getDocument({ data })`, and
 * usePdfDocument.ts already passes that call its own `.slice()` copy, never
 * `doc.source` itself. This `.slice()` just means saveSession never has to
 * depend on that invariant holding everywhere, forever.
 */
export async function saveSession(doc: EditorDocument, slots: Slot[]): Promise<void> {
  try {
    const db = await openDatabase()
    try {
      const record: StoredSession = {
        id: doc.id,
        source: doc.source.slice(),
        pages: doc.pages,
        slots,
      }
      await runWrite(db, (store) => {
        store.put(record, SESSION_KEY)
      })
    } finally {
      db.close()
    }
  } catch (err) {
    warnUnavailable()
    console.error('Failed to save session', err)
  }
}

/**
 * Restores the persisted session, or null if none exists (or storage is
 * unavailable). Never throws -- a failed read leaves the caller free to
 * fall back to the dropzone.
 */
export async function loadSession(): Promise<{ doc: EditorDocument; slots: Slot[] } | null> {
  try {
    const db = await openDatabase()
    try {
      const record = await readRecord(db)
      if (!record) return null
      const doc: EditorDocument = { id: record.id, source: record.source, pages: record.pages }
      return { doc, slots: record.slots }
    } finally {
      db.close()
    }
  } catch (err) {
    warnUnavailable()
    console.error('Failed to load session', err)
    return null
  }
}

/** Genuinely removes the persisted record, used by the toolbar's "Start over". */
export async function clearSession(): Promise<void> {
  try {
    const db = await openDatabase()
    try {
      await runWrite(db, (store) => {
        store.delete(SESSION_KEY)
      })
    } finally {
      db.close()
    }
  } catch (err) {
    warnUnavailable()
    console.error('Failed to clear session', err)
  }
}
