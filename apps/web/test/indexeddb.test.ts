import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * jsdom has no IndexedDB of its own (see task-18-brief.md's "ten prior
 * instances" warning), so every test here stubs `indexedDB` with a fresh
 * fake-indexeddb `IDBFactory` -- chosen because it implements the real
 * IndexedDB spec (transactions, structured-clone-like storage,
 * onupgradeneeded) rather than a hand-rolled mock, so these tests exercise
 * the actual async/event-driven code paths saveSession/loadSession/
 * clearSession run in a browser. A brand new IDBFactory per test (rather
 * than the shared `fake-indexeddb/auto` singleton) keeps tests isolated:
 * nothing written by one test can leak into another.
 */

function makeDoc(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    id: 'doc-1',
    source: new Uint8Array([1, 2, 3, 4, 5]),
    pages: [{ width: 612, height: 792 }],
    ...overrides,
  }
}

function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 's1',
    page: 0,
    x: 10,
    y: 20,
    width: 200,
    text: 'hello',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
    ...overrides,
  }
}

describe('IndexedDB session persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('round-trips the document bytes and slots byte-identically and non-empty', async () => {
    const { saveSession, loadSession } = await import('../src/lib/persistence/indexeddb')

    const doc = makeDoc({ source: new Uint8Array([10, 20, 30, 40]) })
    const slots = [makeSlot({ id: 'a', text: 'Hello' }), makeSlot({ id: 'b', text: 'World' })]

    await saveSession(doc, slots)
    const restored = await loadSession()

    expect(restored).not.toBeNull()
    expect(restored?.doc.id).toBe(doc.id)
    expect(restored?.doc.source.byteLength).toBeGreaterThan(0)
    expect(Array.from(restored!.doc.source)).toEqual(Array.from(doc.source))
    expect(restored?.doc.pages).toEqual(doc.pages)
    expect(restored?.slots).toEqual(slots)
  })

  /**
   * What this proves: a round trip survives the CALLER's reference being
   * detached after saveSession has already returned -- e.g. a later, unrelated
   * getDocument({ data }) call elsewhere in the app transferring the same
   * buffer. It does NOT prove saveSession's own `.slice()` is what makes
   * this true, and should not be read that way: IDBObjectStore.put() does
   * its own structured clone at write time (part of the IndexedDB spec), so
   * the persisted record is already independent of the caller's buffer
   * regardless of whether saveSession additionally copies it. Confirmed by
   * removing that `.slice()` and re-running this exact test: it still
   * passed -- see indexeddb.ts's saveSession doc comment and
   * task-18-report.md's fix-round-1 entry for the full explanation of why
   * the `.slice()` is defence-in-depth, not what this test is checking.
   */
  it('round-trips even if the caller detaches its own source buffer after saveSession returns', async () => {
    const { saveSession, loadSession } = await import('../src/lib/persistence/indexeddb')

    const source = new Uint8Array([1, 2, 3, 4, 5])
    const doc = makeDoc({ source })
    await saveSession(doc, [makeSlot()])

    // structuredClone's transfer option detaches the buffer exactly like a
    // real getDocument({ data }) call would.
    structuredClone(source.buffer, { transfer: [source.buffer] })
    expect(source.byteLength).toBe(0)

    const restored = await loadSession()
    expect(restored?.doc.source.byteLength).toBe(5)
    expect(Array.from(restored!.doc.source)).toEqual([1, 2, 3, 4, 5])
  })

  it('clearSession genuinely removes the record', async () => {
    const { saveSession, loadSession, clearSession } = await import('../src/lib/persistence/indexeddb')

    await saveSession(makeDoc(), [makeSlot()])
    expect(await loadSession()).not.toBeNull()

    await clearSession()

    expect(await loadSession()).toBeNull()
  })

  it('loadSession returns null when no session was ever saved', async () => {
    const { loadSession } = await import('../src/lib/persistence/indexeddb')
    expect(await loadSession()).toBeNull()
  })
})

describe('IndexedDB session persistence: storage unavailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saveSession/loadSession/clearSession never throw when IndexedDB is unavailable, and warn once', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const sonner = await import('sonner')
    const warnSpy = vi.spyOn(sonner.toast, 'warning').mockImplementation(() => 'toast-id')

    const { saveSession, loadSession, clearSession } = await import('../src/lib/persistence/indexeddb')

    // The failure path itself: these must resolve (not reject), and the
    // "unavailable" state must be explicit, not merely "didn't throw".
    await expect(saveSession(makeDoc(), [makeSlot()])).resolves.toBeUndefined()
    await expect(loadSession()).resolves.toBeNull()
    await expect(clearSession()).resolves.toBeUndefined()

    // A user who cannot persist still gets told once, not spammed on every
    // failed call.
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
