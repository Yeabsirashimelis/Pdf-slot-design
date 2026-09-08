import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * Home (apps/web/src/app/page.tsx) is what decides Dropzone vs. Editor.
 * These tests exercise Task 18's "restore on mount, skip the dropzone" and
 * "Start over" requirements at that level -- Editor's own persistence
 * wiring (debounced saveSession) is covered separately in
 * editorSessionPersistence.test.ts.
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
  return { id: 'doc-page-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
}

function makeSlot(): Slot {
  return {
    id: 'restored-slot',
    page: 0,
    x: 10,
    y: 20,
    width: 200,
    text: 'Restored',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
  }
}

describe('Home: session restore on mount', () => {
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

  it('shows the dropzone (not the editor) when no session was saved', async () => {
    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('restores a saved session on mount and skips the dropzone entirely', async () => {
    const { saveSession } = await import('../src/lib/persistence/indexeddb')
    const doc = makeDoc()
    const slot = makeSlot()
    await saveSession(doc, [slot])

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))

    await waitFor(() => {
      expect(container.querySelector('canvas')).not.toBeNull()
    })
    expect(screen.queryByText('Drag a PDF or image here, or')).toBeNull()

    await waitFor(() => {
      expect(container.querySelector('[data-slot-id="restored-slot"]')).not.toBeNull()
    })
  })

  it('"Start over" clears the session and returns to the dropzone', async () => {
    const { saveSession, loadSession } = await import('../src/lib/persistence/indexeddb')
    await saveSession(makeDoc(), [makeSlot()])

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    const startOverButton = await waitFor(() => screen.getByTestId('start-over-button'))
    fireEvent.click(startOverButton)

    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())
    expect(await loadSession()).toBeNull()
  })
})
