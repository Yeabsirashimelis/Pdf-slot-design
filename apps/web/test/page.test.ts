import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakePdfjsDocument, installFontFixtures } from './helpers/editorFixtures'
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
    listFiles: async () =>
      Array.from(memory.files.values()).map((f) => ({
        fileId: f.fileId,
        name: f.name,
        pageCount: f.pages.length,
        slotCount: memory.layouts.get(f.fileId)?.slots.length ?? 0,
        updatedAt: memory.layouts.get(f.fileId)?.updatedAt ?? f.createdAt,
      })),
    deleteFile: async (id: string) => {
      memory.files.delete(id)
      memory.layouts.delete(id)
      memory.values.delete(id)
      if (memory.session?.fileId === id) memory.session = null
    },
  },
}))

vi.mock('@/features/template/openFile', () => ({
  openFile: (...args: unknown[]) => openFileMock(...args),
}))

// A content hash: 64 hex chars. Anything else is a random id the page refuses to restore.
const FILE_ID = 'a'.repeat(64)
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
    getDocumentMock.mockReturnValue(fakePdfjsDocument())

    installFontFixtures()
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
    const restored: OpenedFile = { doc, name: 'known.pdf', fileId: FILE_ID, layout: knownLayout, values: null, step: 'layout' }
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

  it('a restore that fails falls back to the dropzone and clears the session', async () => {
    memory.session = { fileId: FILE_ID, step: 'write' }
    memory.files.set(FILE_ID, { fileId: FILE_ID, name: 'known.pdf', source: bytes, pages: doc.pages, createdAt: 't' })
    openFileMock.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByText('Choose a file')).toBeTruthy())
    expect(screen.queryByTestId('slot-panel')).toBeNull()
    expect(memory.session).toBeNull()
  })

  it('a session whose file is gone falls back to the dropzone and clears the session', async () => {
    memory.session = { fileId: FILE_ID, step: 'write' }

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByText('Choose a file')).toBeTruthy())
    expect(screen.queryByTestId('slot-panel')).toBeNull()
    expect(memory.session).toBeNull()
    expect(openFileMock).not.toHaveBeenCalled()
  })

  it('a session with a random (non-hash) file id is not restored and is cleared', async () => {
    memory.session = { fileId: 'random-uuid', step: 'write' }
    memory.files.set('random-uuid', { fileId: 'random-uuid', name: 'x.pdf', source: bytes, pages: doc.pages, createdAt: 't' })

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    await waitFor(() => expect(screen.getByText('Choose a file')).toBeTruthy())
    expect(screen.queryByTestId('slot-panel')).toBeNull()
    expect(memory.session).toBeNull()
    expect(openFileMock).not.toHaveBeenCalled()
  })

  it('uploading a file opens it in the template editor', async () => {
    const fresh: OpenedFile = { doc, name: 'known.pdf', fileId: FILE_ID, layout: null, values: null, step: 'layout' }
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

  it('keeps the dropzone busy until openFile has settled', async () => {
    let finish!: (v: OpenedFile) => void
    openFileMock.mockReturnValue(new Promise<OpenedFile>((resolve) => { finish = resolve }))

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(openFileMock).toHaveBeenCalledTimes(1))
    // openFile is still running: the spinner must not have cleared back to the idle prompt.
    expect(screen.getByText('Converting…')).toBeTruthy()
    expect(screen.queryByText('Drag a PDF or image here, or')).toBeNull()

    finish({ doc, name: 'known.pdf', fileId: FILE_ID, layout: null, values: null, step: 'layout' })
    await waitFor(() => expect(screen.getByTestId('panel-next')).toBeTruthy())
  })

  it('an upload openFile rejects shows its message and stays on the dropzone', async () => {
    const sonner = await import('sonner')
    const errorSpy = vi.spyOn(sonner.toast, 'error')
    openFileMock.mockRejectedValue(new Error('This PDF is password-protected.'))

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('This PDF is password-protected.'))
    expect(errorSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())
    expect(screen.queryByTestId('slot-panel')).toBeNull()
  })

  it('warns once when the file got a random id (no SubtleCrypto)', async () => {
    const sonner = await import('sonner')
    const warnSpy = vi.spyOn(sonner.toast, 'warning')
    const randomId = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'
    openFileMock.mockResolvedValue({ doc: { ...doc, id: randomId }, fileId: randomId, layout: null, values: null, step: 'layout' })

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(screen.getByTestId('panel-next')).toBeTruthy())
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/insecure connection/)
  })

  it('does not warn when the file id is a content hash', async () => {
    const sonner = await import('sonner')
    const warnSpy = vi.spyOn(sonner.toast, 'warning')
    openFileMock.mockResolvedValue({ doc, fileId: FILE_ID, layout: null, values: null, step: 'layout' })

    const Home = (await import('../src/app/page')).default
    const { container } = render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(screen.getByTestId('panel-next')).toBeTruthy())
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('lists saved files under the dropzone; Open reopens one from its stored bytes', async () => {
    memory.files.set(FILE_ID, { fileId: FILE_ID, name: 'known.pdf', source: bytes, pages: doc.pages, createdAt: '2026-09-13T00:00:00.000Z' })
    memory.layouts.set(FILE_ID, knownLayout)
    const restored: OpenedFile = { doc, name: 'known.pdf', fileId: FILE_ID, layout: knownLayout, values: null, step: 'write' }
    openFileMock.mockResolvedValue(restored)

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))

    const row = await waitFor(() => screen.getByTestId(`saved-file-${FILE_ID}`))
    expect(row.textContent).toContain('known.pdf')
    expect(row.textContent).toMatch(/1 page/)
    expect(row.textContent).toMatch(new RegExp(`${knownLayout.slots.length} slots?`))

    fireEvent.click(screen.getByTestId(`saved-file-open-${FILE_ID}`))
    await waitFor(() => expect(screen.getByTestId('slot-panel')).toBeTruthy())
    const [calledBytes, calledName] = openFileMock.mock.calls[0] as [Uint8Array, string, unknown]
    expect(calledBytes).toBe(bytes)
    expect(calledName).toBe('known.pdf')
  })

  it('Delete asks first, then removes the file from the list and the store', async () => {
    memory.files.set(FILE_ID, { fileId: FILE_ID, name: 'known.pdf', source: bytes, pages: doc.pages, createdAt: 't' })
    memory.layouts.set(FILE_ID, knownLayout)

    const Home = (await import('../src/app/page')).default
    render(createElement(Home))
    await waitFor(() => screen.getByTestId(`saved-file-${FILE_ID}`))

    fireEvent.click(screen.getByTestId(`saved-file-delete-${FILE_ID}`))
    // Still there until confirmed.
    expect(memory.files.has(FILE_ID)).toBe(true)
    fireEvent.click(await waitFor(() => screen.getByTestId('confirm-delete-file')))
    await waitFor(() => expect(screen.queryByTestId(`saved-file-${FILE_ID}`)).toBeNull())
    expect(memory.files.has(FILE_ID)).toBe(false)
    expect(memory.layouts.has(FILE_ID)).toBe(false)
  })

  it('shows no list when nothing is saved', async () => {
    const Home = (await import('../src/app/page')).default
    render(createElement(Home))
    await waitFor(() => expect(screen.getByText('Drag a PDF or image here, or')).toBeTruthy())
    expect(screen.queryByTestId('saved-files')).toBeNull()
  })
})
