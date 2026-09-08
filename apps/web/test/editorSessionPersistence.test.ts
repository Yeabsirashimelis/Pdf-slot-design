import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * Proves Editor is actually wired to saveSession -- not merely that
 * indexeddb.ts works in isolation (see indexeddb.test.ts). Per
 * task-18-brief.md's "standing requirement": stubbing saveSession to a
 * no-op must turn this suite red. It was confirmed to do so before this
 * task's commit -- see task-18-report.md for the exact failure message.
 */

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

// Only the "stays usable when IndexedDB is unavailable" suite below drives a
// real commit (place text, blur) -- the other two suites in this file never
// reach renderPdf. Mocked at module scope (rather than per-test) because
// vi.mock is itself hoisted above every import in the file regardless of
// where it's written.
const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return {
    ...actual,
    renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
  }
})

class FakeFontFace {
  family: string
  source: unknown
  constructor(family: string, source: unknown) {
    this.family = family
    this.source = source
  }
  async load() {
    return this
  }
}

const FONT_DIR = path.resolve(__dirname, '../public/fonts')
const FONT_FILES = [
  'PT_Sans-Web-Regular.ttf',
  'PT_Sans-Web-Bold.ttf',
  'PT_Serif-Web-Regular.ttf',
  'PT_Serif-Web-Bold.ttf',
  'IBMPlexMono-Regular.ttf',
]

function makeDoc(): EditorDocument {
  return { id: 'doc-persist-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
}

describe('Editor: debounced session persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)

    getDocumentMock.mockReset()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        })),
      }),
      destroy: vi.fn(),
    })

    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const file = FONT_FILES.find((f) => url.endsWith(f))
        if (!file) throw new Error(`unexpected fetch in test: ${url}`)
        const bytes = readFileSync(path.join(FONT_DIR, file))
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saves the document and slots to IndexedDB ~1s after a slot is placed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { Editor } = await import('../src/features/editor/Editor')
    const { loadSession } = await import('../src/lib/persistence/indexeddb')

    const doc = makeDoc()
    const { container } = render(createElement(Editor, { doc }))

    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas')
      if (!el) throw new Error('canvas not mounted yet')
      return el
    })
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })

    // Nothing should be written before the debounce window elapses.
    await vi.advanceTimersByTimeAsync(500)
    expect(await loadSession()).toBeNull()

    await vi.advanceTimersByTimeAsync(600)

    const restored = await loadSession()
    expect(restored).not.toBeNull()
    expect(restored?.doc.id).toBe(doc.id)
    expect(restored?.doc.source.byteLength).toBeGreaterThan(0)
    expect(Array.from(restored!.doc.source)).toEqual(Array.from(doc.source))
    expect(restored?.slots.length).toBe(1)

    vi.useRealTimers()
  })

  it('flushes the pending write on unmount instead of dropping it', async () => {
    // The debounce effect's cleanup cancels the timer, and cleanup also
    // runs on unmount -- so without an explicit flush, closing the tab (or
    // any unmount) silently discarded up to a second of edits, in the
    // feature whose entire purpose is not losing them.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { Editor } = await import('../src/features/editor/Editor')
    const { loadSession } = await import('../src/lib/persistence/indexeddb')

    const doc = makeDoc()
    const { container, unmount } = render(createElement(Editor, { doc }))

    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas')
      if (!el) throw new Error('canvas not mounted yet')
      return el
    })
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })

    // Well inside the debounce window: nothing has been written yet.
    await vi.advanceTimersByTimeAsync(200)
    expect(await loadSession()).toBeNull()

    unmount()

    await waitFor(async () => {
      const restored = await loadSession()
      expect(restored?.slots.length).toBe(1)
    })

    vi.useRealTimers()
  })

  it('flushes the pending write on beforeunload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { Editor } = await import('../src/features/editor/Editor')
    const { loadSession } = await import('../src/lib/persistence/indexeddb')

    const doc = makeDoc()
    const { container } = render(createElement(Editor, { doc }))

    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas')
      if (!el) throw new Error('canvas not mounted yet')
      return el
    })
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })

    await vi.advanceTimersByTimeAsync(200)
    expect(await loadSession()).toBeNull()

    window.dispatchEvent(new Event('beforeunload'))

    await waitFor(async () => {
      const restored = await loadSession()
      expect(restored?.slots.length).toBe(1)
    })

    vi.useRealTimers()
  })

  it('restores a session on mount via initialSlots -- the restored slot renders without re-clicking the canvas', async () => {
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
    const restoredSlot: Slot = {
      id: 'restored-slot',
      page: 0,
      x: 50,
      y: 700,
      width: 200,
      text: 'Restored text',
      fontId: 'sans',
      size: 14,
      color: { r: 0, g: 0, b: 0 },
      align: 'left',
      lineHeight: 1.2,
    }

    const { container } = render(createElement(Editor, { doc, initialSlots: [restoredSlot] }))

    await waitFor(() => {
      const slotDiv = container.querySelector('[data-slot-id="restored-slot"]')
      expect(slotDiv).not.toBeNull()
    })
  })
})

/**
 * Fix round 1 (Important #2): indexeddb.test.ts's "storage unavailable"
 * suite only proves saveSession/loadSession/clearSession resolve rather
 * than throw -- that's the persistence module in isolation. It does NOT
 * prove a rendered Editor stays usable: a user with IndexedDB unavailable
 * must still be able to place text, see it commit, and download real bytes.
 * This suite renders the real Editor (canvas click, real textarea, real
 * blur, real Toolbar download button) with `indexedDB` stubbed `undefined`
 * end to end.
 */
describe('Editor: stays usable when IndexedDB is unavailable', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined)

    getDocumentMock.mockReset()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        })),
      }),
      destroy: vi.fn(),
    })

    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const file = FONT_FILES.find((f) => url.endsWith(f))
        if (!file) throw new Error(`unexpected fetch in test: ${url}`)
        const bytes = readFileSync(path.join(FONT_DIR, file))
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
      }),
    )

    renderPdfMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('places text, commits it to the canvas, and downloads real rendered bytes -- storage failing never blocks editing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const { Editor } = await import('../src/features/editor/Editor')
    const sonner = await import('sonner')
    const warnSpy = vi.spyOn(sonner.toast, 'warning')

    const doc = makeDoc()
    const renderedOutput = new Uint8Array([42, 42, 42, 42])
    renderPdfMock.mockResolvedValue(renderedOutput)

    // Download plumbing, mirrored from Toolbar.test.ts: a real Blob/URL
    // constructor extended (not replaced) so jsdom's <a href> assignment
    // still works, plus a spy on the anchor's click(). Captured on a plain
    // object (rather than a re-assigned `let`) so TypeScript's control-flow
    // analysis doesn't narrow the variable to its initial `null` literal at
    // the read below -- it can't see that FakeBlob's constructor, invoked
    // indirectly through fireEvent.click(downloadButton), reassigns it.
    const captured: { blobParts: unknown[] | null } = { blobParts: null }
    const anchorClick = vi.fn()
    class FakeURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:fake-url')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', FakeURL)
    class FakeBlob {
      parts: unknown[]
      constructor(parts: unknown[]) {
        this.parts = parts
        captured.blobParts = parts
      }
    }
    vi.stubGlobal('Blob', FakeBlob)
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = anchorClick
      return el
    })

    const { container } = render(createElement(Editor, { doc }))

    const canvas = await waitFor(() => {
      const el = container.querySelector('canvas')
      if (!el) throw new Error('canvas not mounted yet')
      return el
    })
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })

    const textarea = await waitFor(() => {
      const el = container.querySelector('textarea')
      if (!el) throw new Error('textarea not mounted yet')
      return el
    })
    fireEvent.change(textarea, { target: { value: 'Still works offline-storage' } })
    fireEvent.blur(textarea)

    // The edit actually committed and rendered -- not merely "didn't throw".
    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))
    const slotDiv = container.querySelector('[data-slot-id]')
    expect(slotDiv).not.toBeNull()
    await waitFor(() => expect(slotDiv?.querySelectorAll('span').length).toBe(0))

    // Download still produces the real rendered bytes.
    const downloadButton = container.querySelector('[data-testid="download-button"]') as HTMLButtonElement
    expect(downloadButton).not.toBeNull()
    fireEvent.click(downloadButton)
    // Download awaits any in-flight render before building the Blob (see
    // Toolbar's `flush` prop), so the Blob exists a microtask later.
    await waitFor(() => expect(captured.blobParts).not.toBeNull())

    expect(captured.blobParts).not.toBeNull()
    expect((captured.blobParts as unknown[])[0]).toBe(renderedOutput)
    expect(anchorClick).toHaveBeenCalledTimes(1)

    // The degrade path was genuinely exercised, not silently skipped: the
    // debounced save (which never fired before this point -- nothing here
    // advanced its timer yet) hits IndexedDB-unavailable and warns once.
    await vi.advanceTimersByTimeAsync(1100)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
