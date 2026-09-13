import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession } from '@/lib/persistence/templateStore'
import type { OpenedFile } from '@/features/template/openFile'

/**
 * Home (apps/web/src/app/page.tsx) is what decides Dropzone vs.
 * TemplateEditor: it restores the last open file on mount and hands an
 * upload to openFile. Both the store and openFile are mocked at module
 * scope; TemplateEditor renders the real Editor, so pdf.js and the fonts
 * are stubbed the same way TemplateEditor.test.ts does.
 */

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

const { memory, openFileMock } = vi.hoisted(() => {
  const memory = {
    files: new Map<string, StoredFile>(),
    layouts: new Map<string, TemplateLayout>(),
    values: new Map<string, TemplateValues>(),
    session: null as OpenSession | null,
    reset() {
      this.files.clear()
      this.layouts.clear()
      this.values.clear()
      this.session = null
    },
  }
  return { memory, openFileMock: vi.fn() }
})

vi.mock('@/lib/persistence/indexedDbTemplateStore', () => ({
  templateStore: {
    getFile: async (id: string) => memory.files.get(id) ?? null,
    putFile: async (f: StoredFile) => { memory.files.set(f.fileId, f) },
    getLayout: async (id: string) => memory.layouts.get(id) ?? null,
    putLayout: async (l: TemplateLayout) => { memory.layouts.set(l.fileId, l) },
    getValues: async (id: string) => memory.values.get(id) ?? null,
    putValues: async (v: TemplateValues) => { memory.values.set(v.fileId, v) },
    get: async () => memory.session,
    put: async (s: OpenSession) => { memory.session = s },
    clear: async () => { memory.session = null },
  },
}))

vi.mock('@/features/template/openFile', () => ({
  openFile: (...args: unknown[]) => openFileMock(...args),
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

const FILE_ID = 'f'
const bytes = new Uint8Array([1, 2, 3])
const doc: EditorDocument = { id: FILE_ID, source: bytes, pages: [{ width: 612, height: 792 }] }
const knownLayout: TemplateLayout = {
  fileId: FILE_ID, updatedAt: 't',
  slots: [
    { id: 's1', name: 'CO#', order: 0, page: 0, x: 50, y: 700, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
  ],
}

describe('Home', () => {
  beforeEach(() => {
    memory.reset()
    openFileMock.mockReset()
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

  it('shows the dropzone when nothing is open', async () => {
    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())
    expect(screen.queryByTestId('slot-panel')).toBeNull()
    expect(openFileMock).not.toHaveBeenCalled()
  })

  it('restores the last open file into its step on load', async () => {
    memory.session = { fileId: FILE_ID, step: 'write' }
    memory.files.set(FILE_ID, { fileId: FILE_ID, name: 'known.pdf', source: bytes, pages: doc.pages, createdAt: 't' })
    // openFile's own landing rule says 'layout'; the session's step must win.
    const restored: OpenedFile = { doc, fileId: FILE_ID, layout: knownLayout, values: null, step: 'layout' }
    openFileMock.mockResolvedValue(restored)

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByTestId('slot-panel')).toBeTruthy())
    expect(screen.getByTestId('panel-back')).toBeTruthy()
    expect(screen.queryByTestId('panel-next')).toBeNull()
    expect(screen.queryByText('Drag a PDF or image here, or')).toBeNull()
    expect(openFileMock).toHaveBeenCalledTimes(1)
    const [calledBytes, calledName] = openFileMock.mock.calls[0] as [Uint8Array, string, unknown]
    expect(calledBytes).toBe(bytes)
    expect(calledName).toBe('known.pdf')
  })

  it('uploading a file opens it in the template editor', async () => {
    const fresh: OpenedFile = { doc, fileId: FILE_ID, layout: null, values: null, step: 'layout' }
    openFileMock.mockResolvedValue(fresh)

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByTestId('panel-next')).toBeTruthy())
    expect(screen.getByTestId('slot-panel')).toBeTruthy()
    expect(screen.queryByText('Drag a PDF or image here, or')).toBeNull()
    expect(openFileMock).toHaveBeenCalledTimes(1)
    const [calledBytes, calledName] = openFileMock.mock.calls[0] as [Uint8Array, string, unknown]
    expect(calledBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(calledBytes)).toEqual([1])
    expect(calledName).toBe('x.pdf')
  })
})
