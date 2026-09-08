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
