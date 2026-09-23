import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFontFixtures } from './helpers/editorFixtures'
import type { EditorDocument, Slot, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import type { OpenedFile } from '@/features/template/openFile'

/**
 * The one-screen shell, driven the way a user would: click the page, name
 * the slot in place, fill it in from the panel or the page, save,
 * download, leave. Render-on-commit is off, so the only render is the
 * one Download performs.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return {
    ...actual,
    renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
  }
})

// pdf.js is mocked at the same seam as Editor.test.ts: this suite drives
// the real workspace (canvas click -> overlay -> textarea) but never needs
// pixels drawn in jsdom.
vi.mock('pdfjs-dist', async () => {
  const { fakePdfjsDocument } = await import('./helpers/editorFixtures')
  return { GlobalWorkerOptions: {}, getDocument: () => fakePdfjsDocument() }
})

HTMLElement.prototype.setPointerCapture ??= () => {}

function memoryStore() {
  const layouts = new Map<string, TemplateLayout>()
  const values = new Map<string, TemplateValues>()
  let session: OpenSession | null = null
  const store: TemplateStore & SessionStore & { layouts: typeof layouts; values: typeof values; session(): OpenSession | null } = {
    layouts, values, session: () => session,
    getFile: async () => null,
    putFile: async () => {},
    getLayout: async (id) => layouts.get(id) ?? null,
    putLayout: async (l) => { layouts.set(l.fileId, l) },
    getValues: async (id) => values.get(id) ?? null,
    putValues: async (v) => { values.set(v.fileId, v) },
    listFiles: async () => [],
    deleteFile: async () => {},
    get: async () => session,
    put: async (s) => { session = s },
    clear: async () => { session = null },
  }
  return store
}

const doc: EditorDocument = { id: 'file-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
const newFile: OpenedFile = { doc, name: 'form.pdf', fileId: 'file-1', layout: null, values: null }
const knownLayout: TemplateLayout = {
  fileId: 'file-1', updatedAt: 't',
  slots: [
    { id: 's1', name: 'CO#', order: 0, page: 0, x: 50, y: 700, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    { id: 's2', name: 'Date', order: 1, page: 0, x: 50, y: 650, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
  ],
}
const knownFile: OpenedFile = {
  doc, name: 'form.pdf', fileId: 'file-1', layout: knownLayout,
  values: { fileId: 'file-1', updatedAt: 't', values: { s2: '07/11/2024' } },
}

/** waitFor only retries on throw, so a null querySelector must throw. */
async function waitForCanvas(container: HTMLElement) {
  return waitFor(() => {
    const el = container.querySelector('canvas')
    if (!el) throw new Error('canvas not mounted yet')
    return el
  })
}

/** Click the page, type the name into the box, Enter. */
async function placeSlot(container: HTMLElement, name: string, at = { clientX: 50, clientY: 50 }) {
  const canvas = await waitForCanvas(container)
  fireEvent.click(canvas, at)
  const input = await waitFor(() => screen.getByTestId('slot-name-inline') as HTMLInputElement)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const rowNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid^="slot-name-"]')).map((el) => el.textContent)

describe('TemplateEditor', () => {
  beforeEach(() => {
    installFontFixtures()
    renderPdfMock.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('records the open file; a click on the page creates a slot named in place, listed in the panel with a field', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await waitFor(() => expect(store.session()).toEqual({ fileId: 'file-1' }))
    expect(screen.getByTestId('empty-hint')).toBeTruthy()

    await placeSlot(container, 'CO#')

    await waitFor(() => expect(rowNames(container)).toEqual(['CO#']))
    const box = container.querySelector('[data-slot-id]') as HTMLElement
    // The name is the box's placeholder, the inspector shows it, the row has a field.
    expect(box.querySelector('[data-slot-line][data-placeholder]')?.textContent).toBe('CO#')
    expect((screen.getByTestId('inspector-name') as HTMLInputElement).value).toBe('CO#')
    expect(screen.getByTestId(`slot-field-${box.dataset.slotId}`)).toBeTruthy()

    fireEvent.click(screen.getByTestId(`slot-remove-${box.dataset.slotId}`))
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('naming a slot hands the caret to its text box, so the next thing typed is exported', async () => {
    // The trap this closes: a named-but-empty slot shows its name on the
    // page as a placeholder. It reads exactly like content -- but it is
    // not, and the download (rightly) has none of it. Naming therefore
    // ends in the text box, with the caret in it.
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await placeSlot(container, 'Added')

    const box = await waitFor(() => {
      const el = container.querySelector('[data-slot-id]')
      if (!el) throw new Error('overlay not mounted yet')
      return el as HTMLElement
    })
    const onPage = box.querySelector('textarea') as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(onPage))

    // So typing straight after naming becomes the slot's text, not its name.
    fireEvent.change(onPage, { target: { value: 'Added' } })
    expect((screen.getByTestId(`slot-field-${box.dataset.slotId}`) as HTMLTextAreaElement).value).toBe('Added')
  })

  it('an empty name discards the new slot: Escape, or Enter/blur with nothing typed', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    const canvas = await waitForCanvas(container)

    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    let input = await waitFor(() => screen.getByTestId('slot-name-inline') as HTMLInputElement)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)

    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    input = await waitFor(() => screen.getByTestId('slot-name-inline') as HTMLInputElement)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)

    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    input = await waitFor(() => screen.getByTestId('slot-name-inline') as HTMLInputElement)
    fireEvent.blur(input)
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('a known file opens with its slots and values; typing in a field shows on the page and vice versa; Save persists both records', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const sonner = await import('sonner')
    const success = vi.spyOn(sonner.toast, 'success')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))

    const dateField = await waitFor(() => screen.getByTestId('slot-field-s2') as HTMLTextAreaElement)
    expect(dateField.value).toBe('07/11/2024')
    expect(rowNames(container)).toEqual(['CO#', 'Date'])
    // The overlay mounts once the fonts are loaded.
    await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s2"] textarea')
      if (!el) throw new Error('overlay not mounted yet')
      return el
    })
    expect((container.querySelector('[data-slot-id="s2"] textarea') as HTMLTextAreaElement).value).toBe('07/11/2024')

    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })
    expect((container.querySelector('[data-slot-id="s1"] textarea') as HTMLTextAreaElement).value).toBe('001')

    fireEvent.change(container.querySelector('[data-slot-id="s2"] textarea') as HTMLTextAreaElement, { target: { value: '08/01/2024' } })
    expect((screen.getByTestId('slot-field-s2') as HTMLTextAreaElement).value).toBe('08/01/2024')

    fireEvent.click(screen.getByTestId('panel-save'))
    await waitFor(() => expect(store.values.get('file-1')?.values).toEqual({ s1: '001', s2: '08/01/2024' }))
    const saved = store.layouts.get('file-1')!
    expect(saved.slots.map((s) => [s.name, s.order])).toEqual([['CO#', 0], ['Date', 1]])
    expect('text' in saved.slots[0]!).toBe(false)
    expect(success).toHaveBeenCalled()
  })

  it('a multi-line value survives a round trip through the form field', async () => {
    // The field used to be an <input type=text>, which strips newlines: one
    // keystroke in the form flattened a two-line value the user had typed
    // on the page.
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    const onPage = await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s1"] textarea')
      if (!el) throw new Error('overlay not mounted yet')
      return el as HTMLTextAreaElement
    })
    fireEvent.change(onPage, { target: { value: 'line one\nline two' } })
    const field = screen.getByTestId('slot-field-s1') as HTMLTextAreaElement
    expect(field.value).toBe('line one\nline two')
    fireEvent.change(field, { target: { value: `${field.value}!` } })
    expect((container.querySelector('[data-slot-id="s1"] textarea') as HTMLTextAreaElement).value).toBe('line one\nline two!')
  })

  it('typing is saved on its own after ~1s, without pressing Save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '00' } })
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })
    await vi.advanceTimersByTimeAsync(1100)
    expect(store.values.get('file-1')?.values.s1).toBe('001')
  })

  it('an untouched new file persists nothing -- not after the debounce, not on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { unmount } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('empty-hint'))
    await vi.advanceTimersByTimeAsync(1100)
    unmount()
    expect(store.layouts.size).toBe(0)
    expect(store.values.size).toBe(0)
  })

  it('renaming from the inspector and from the row both change the name everywhere', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-row-s1'))

    fireEvent.click(screen.getByTestId('slot-row-s1'))
    const inspector = await waitFor(() => screen.getByTestId('inspector-name') as HTMLInputElement)
    expect(inspector.value).toBe('CO#')
    fireEvent.change(inspector, { target: { value: 'Change order' } })
    fireEvent.keyDown(inspector, { key: 'Enter' })
    await waitFor(() => expect(rowNames(container)).toEqual(['Change order', 'Date']))

    fireEvent.doubleClick(screen.getByTestId('slot-name-s2'))
    const inline = await waitFor(() => screen.getByTestId('slot-rename-input') as HTMLInputElement)
    fireEvent.change(inline, { target: { value: 'Due date' } })
    fireEvent.keyDown(inline, { key: 'Enter' })
    await waitFor(() => expect(rowNames(container)).toEqual(['Change order', 'Due date']))

    fireEvent.click(screen.getByTestId('panel-save'))
    await waitFor(() => expect(store.layouts.get('file-1')?.slots.map((s) => s.name)).toEqual(['Change order', 'Due date']))
  })

  it('the padlock freezes the layout: no moving, no placing, no typography -- typing still works', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    const box = await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s1"]')
      if (!el) throw new Error('overlay not mounted yet')
      return el as HTMLElement
    })
    const tag = box.querySelector('[data-testid="slot-label"]') as HTMLElement
    expect(tag.style.cursor).toBe('move')

    fireEvent.click(screen.getByTestId('lock-toggle'))
    // Locked, the name tag stops being a handle.
    await waitFor(() => expect(tag.style.pointerEvents).toBe('none'))
    fireEvent.click(screen.getByTestId('slot-row-s1'))
    await waitFor(() => expect((screen.getByTestId('font-select-trigger') as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByTestId('slot-remove-s1') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(await waitForCanvas(container), { clientX: 300, clientY: 300 })
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(2)

    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: 'still typing' } })
    expect((box.querySelector('textarea') as HTMLTextAreaElement).value).toBe('still typing')
  })

  it('Download performs the one render, of the values (never the placeholder names), and saves exactly its bytes', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const renderedOutput = new Uint8Array([9, 9, 9])
    renderPdfMock.mockResolvedValue(renderedOutput)

    const captured: { blobParts: unknown[] | null } = { blobParts: null }
    class FakeURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:fake-url')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', FakeURL)
    class FakeBlob {
      constructor(parts: unknown[]) {
        captured.blobParts = parts
      }
    }
    vi.stubGlobal('Blob', FakeBlob)
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = vi.fn()
      return el
    })

    render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: 'typed' } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(renderPdfMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(captured.blobParts).not.toBeNull())
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    const slots = renderPdfMock.mock.calls[0]![1]
    expect(slots.map((s) => s.text)).toEqual(['typed', '07/11/2024'])
    expect(captured.blobParts?.[0]).toBe(renderedOutput)
  })

  it('blocks download and names the offending characters for unsupported text', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const sonner = await import('sonner')
    const errorSpy = vi.spyOn(sonner.toast, 'error')
    render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: 'Hello 日本語' } })

    await waitFor(() => expect(screen.getByTestId('download-button').getAttribute('aria-disabled')).toBe('true'))
    const message = String(errorSpy.mock.calls.at(-1)?.[0])
    expect(message).toContain('日')

    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: 'Hello world' } })
    await waitFor(() => expect(screen.getByTestId('download-button').getAttribute('aria-disabled')).toBe('false'))
  })

  it('Start over clears the open session and hands off', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const onStartOver = vi.fn()
    render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver }))
    await waitFor(() => expect(store.session()).not.toBeNull())
    fireEvent.click(screen.getByTestId('start-over-button'))
    await waitFor(() => expect(onStartOver).toHaveBeenCalledTimes(1))
    expect(store.session()).toBeNull()
    expect(store.layouts.size).toBe(0) // it never deletes a saved layout (there is none here either way)
  })

  it('Start over still hands off when clearing the session fails', async () => {
    // The user asked to leave; a storage error must not trap them in the
    // editor. (The stale session is at worst re-tried on the next reload.)
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = { ...memoryStore(), clear: async () => { throw new Error('quota') } }
    const onStartOver = vi.fn()
    render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver }))
    await waitFor(() => screen.getByTestId('start-over-button'))
    fireEvent.click(screen.getByTestId('start-over-button'))
    await waitFor(() => expect(onStartOver).toHaveBeenCalledTimes(1))
  })

  it('duplicating from a row adds a second slot with the same settings, named "<name> copy", on the page and in the panel', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: { ...knownFile, values: null }, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-duplicate-s1'))
    await waitFor(() => {
      if (container.querySelectorAll('[data-slot-id]').length < 2) throw new Error('overlays not mounted yet')
    })

    fireEvent.click(screen.getByTestId('slot-duplicate-s1'))

    // Panel order is reading order: the copy sits 12pt below CO#, above Date.
    await waitFor(() => expect(rowNames(container)).toEqual(['CO#', 'CO# copy', 'Date']))
    const boxes = Array.from(container.querySelectorAll('[data-slot-id]'))
    expect(boxes).toHaveLength(3)
    // The copy keeps the source's width and is selected.
    const source = boxes[0] as HTMLElement
    const copy = boxes[2] as HTMLElement
    expect(copy.style.width).toBe(source.style.width)
    expect(copy.dataset.slotId).not.toBe(source.dataset.slotId)
    expect(copy.style.outline).toContain('var(--slot-selection)')

    // A second duplicate of the same source is numbered, not "copy copy".
    fireEvent.click(screen.getByTestId('slot-duplicate-s1'))
    await waitFor(() => expect(rowNames(container)).toEqual(['CO#', 'CO# copy', 'CO# copy (2)', 'Date']))

    // Save persists the copies with their own names.
    fireEvent.click(screen.getByTestId('panel-save'))
    await waitFor(() => expect(store.layouts.get('file-1')?.slots).toHaveLength(4))
    expect(store.layouts.get('file-1')!.slots.map((s) => s.name)).toEqual(['CO#', 'Date', 'CO# copy', 'CO# copy (2)'])
  })

  it('Ctrl+C / Ctrl+V pastes the copied slot on the current page, under the pointer', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const twoPages: OpenedFile = {
      ...knownFile, values: null,
      doc: { ...doc, pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }] },
    }
    const { container } = render(createElement(TemplateEditor, { opened: twoPages, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-row-s1'))
    await waitFor(() => {
      if (container.querySelectorAll('[data-slot-id]').length < 2) throw new Error('overlays not mounted yet')
    })

    fireEvent.click(screen.getByTestId('slot-row-s1'))
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    // The clipboard outlives the source.
    fireEvent.click(screen.getByTestId('slot-remove-s1'))
    fireEvent.click(screen.getByLabelText('Next page'))
    await waitFor(() => expect(container.querySelectorAll('[data-slot-id]')).toHaveLength(0))

    // The pointer is over the page: the copy lands under it. jsdom reports
    // a zero rect and the fit lands on 100%, so client px are stage px.
    const stage = screen.getByTestId('page-stage')
    fireEvent.pointerMove(stage, { clientX: 80, clientY: 40 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    let boxes = container.querySelectorAll('[data-slot-id]')
    expect(boxes).toHaveLength(1)
    const pasted = boxes[0] as HTMLElement
    expect(pasted.style.left).toBe('80px')
    expect(pasted.style.top).toBe('40px')
    expect(pasted.style.outline).toContain('var(--slot-selection)')
    // The source was removed above, so its name is free and the paste
    // takes it back rather than inventing "CO# copy".
    expect(rowNames(container)).toEqual(['Date', 'CO#'])

    // Pointer gone: a repeat paste cascades 12pt from the previous one.
    fireEvent.pointerLeave(stage)
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    boxes = container.querySelectorAll('[data-slot-id]')
    expect(boxes).toHaveLength(2)
    const second = boxes[1] as HTMLElement
    expect(parseFloat(second.style.left)).toBeCloseTo(80 + 12, 3)
    expect(parseFloat(second.style.top)).toBeCloseTo(40 + 12, 3)
    // Now "CO#" is taken, so the next one is a copy.
    expect(rowNames(container)).toEqual(['Date', 'CO#', 'CO# copy'])
  })

  it('Alt+drag leaves the slot where it is and drags a copy named "<name> copy"', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: { ...knownFile, values: null }, store, onStartOver: vi.fn() }))
    const source = await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s1"]')
      if (!el) throw new Error('overlay not mounted yet')
      return el as HTMLElement
    })
    const before = { left: source.style.left, top: source.style.top }

    // The name tag is the handle (the box itself is for text), and it
    // only shows while the pointer is on the slot -- so hover it first,
    // exactly as a user reaching for it does.
    const tag = source.querySelector('[data-testid="slot-label"]') as HTMLElement
    expect(tag.style.opacity).toBe('0')
    fireEvent.pointerOver(tag)
    expect(tag.style.opacity).toBe('1')
    fireEvent.pointerDown(tag, { pointerId: 1, clientX: 0, clientY: 0, altKey: true })
    fireEvent.pointerMove(tag, { pointerId: 1, clientX: 30, clientY: 20, altKey: true })
    fireEvent.pointerUp(tag, { pointerId: 1 })

    const boxes = Array.from(container.querySelectorAll('[data-slot-id]')) as HTMLElement[]
    expect(boxes).toHaveLength(3)
    expect(source.style.left).toBe(before.left)
    expect(source.style.top).toBe(before.top)
    const copy = boxes.find((b) => b.dataset.slotId !== 's1' && b.dataset.slotId !== 's2')!
    expect(parseFloat(copy.style.left)).toBeCloseTo(parseFloat(before.left) + 30, 3)
    expect(parseFloat(copy.style.top)).toBeCloseTo(parseFloat(before.top) + 20, 3)
    expect(copy.style.outline).toContain('var(--slot-selection)')
    expect(rowNames(container)).toContain('CO# copy')
  })

  it('Ctrl+X lifts a slot out and Ctrl+V puts it down again, keeping its name and its text', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-row-s1'))
    await waitFor(() => {
      if (container.querySelectorAll('[data-slot-id]').length < 2) throw new Error('overlays not mounted yet')
    })

    fireEvent.click(screen.getByTestId('slot-row-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: 'carried over' } })
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    await waitFor(() => expect(rowNames(container)).toEqual(['Date']))

    const stage = screen.getByTestId('page-stage')
    fireEvent.pointerMove(stage, { clientX: 120, clientY: 60 })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })

    // Its own name back (not "CO# copy"), and what was typed into it.
    await waitFor(() => expect(rowNames(container)).toEqual(['CO#', 'Date']))
    const pasted = Array.from(container.querySelectorAll('[data-slot-id]')).find((b) => (b as HTMLElement).dataset.slotId !== 's2') as HTMLElement
    expect((screen.getByTestId(`slot-field-${pasted.dataset.slotId}`) as HTMLTextAreaElement).value).toBe('carried over')
    expect(pasted.style.left).toBe('120px')
  })

  it('the page stage is not text-selectable and never starts a native drag (which would hijack a slot drag)', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    render(createElement(TemplateEditor, { opened: knownFile, store: memoryStore(), onStartOver: vi.fn() }))
    const stage = await waitFor(() => screen.getByTestId('page-stage'))
    expect(stage.style.userSelect).toBe('none')
    // A native dragstart bubbling from anywhere inside the stage is cancelled.
    const box = await waitFor(() => {
      const el = stage.querySelector('[data-slot-id="s1"]')
      if (!el) throw new Error('no slot yet')
      return el
    })
    expect(fireEvent.dragStart(box)).toBe(false)
  })
})
