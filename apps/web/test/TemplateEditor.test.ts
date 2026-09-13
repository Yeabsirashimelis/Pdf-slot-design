import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFontFixtures } from './helpers/editorFixtures'
import type { EditorDocument, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import type { OpenedFile } from '@/features/template/openFile'

// pdf.js is mocked at the same seam as Editor.test.ts: this suite drives
// the real Editor (canvas click -> overlay -> textarea) but never needs
// pixels drawn in jsdom. Render-on-commit is off by default, so renderPdf
// is never reached and @pdf-slot/core stays unmocked.
vi.mock('pdfjs-dist', async () => {
  const { fakePdfjsDocument } = await import('./helpers/editorFixtures')
  return { GlobalWorkerOptions: {}, getDocument: () => fakePdfjsDocument() }
})

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
    get: async () => session,
    put: async (s) => { session = s },
    clear: async () => { session = null },
  }
  return store
}

const doc: EditorDocument = { id: 'file-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
const newFile: OpenedFile = { doc, fileId: 'file-1', layout: null, values: null, step: 'layout' }
const knownLayout: TemplateLayout = {
  fileId: 'file-1', updatedAt: 't',
  slots: [
    { id: 's1', name: 'CO#', order: 0, page: 0, x: 50, y: 700, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    { id: 's2', name: 'Date', order: 1, page: 0, x: 50, y: 650, width: 200, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
  ],
}
const knownFile: OpenedFile = {
  doc, fileId: 'file-1', layout: knownLayout, step: 'write',
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

async function placeSlot(container: HTMLElement, name: string) {
  const canvas = await waitForCanvas(container)
  fireEvent.click(canvas, { clientX: 50, clientY: 50 })
  const input = await waitFor(() => screen.getByTestId('slot-name-input') as HTMLInputElement)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    installFontFixtures()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('a new file starts in the layout step; placing asks for a name and adds a chip; ✕ removes the slot from the page', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    expect(screen.getByTestId('panel-next')).toBeTruthy()
    await waitFor(() => expect(store.session()).toEqual({ fileId: 'file-1', step: 'layout' }))

    await placeSlot(container, 'CO#')
    const chip = await waitFor(() => {
      const el = container.querySelector('[data-testid^="slot-chip-"]:not([data-testid^="slot-chip-remove-"])')
      if (!el) throw new Error('no slot chip yet')
      return el as HTMLElement
    })
    expect(chip.textContent).toContain('CO#')
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(1)

    const id = (container.querySelector('[data-slot-id]') as HTMLElement).dataset.slotId!
    fireEvent.click(screen.getByTestId(`slot-chip-remove-${id}`))
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('cancelling the name dialog places nothing', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    const canvas = await waitForCanvas(container)
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByTestId('slot-name-cancel'))
    fireEvent.click(screen.getByTestId('slot-name-cancel'))
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(0)
  })

  it('Next saves the layout (names, order, no text) and enters the write step with locked, empty slots', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await placeSlot(container, 'CO#')
    // Sample text typed in step 1 is not a value.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'sample' } })
    fireEvent.blur(textarea)

    fireEvent.click(screen.getByTestId('panel-next'))

    await waitFor(() => expect(store.layouts.get('file-1')).toBeDefined())
    const saved = store.layouts.get('file-1')!
    expect(saved.slots.map((s) => [s.name, s.order])).toEqual([['CO#', 0]])
    expect('text' in saved.slots[0]!).toBe(false)
    expect(store.session()).toEqual({ fileId: 'file-1', step: 'write' })

    const box = container.querySelector('[data-slot-id]') as HTMLElement
    expect(box.style.cursor).toBe('text')
    const field = screen.getByTestId(`slot-field-${box.dataset.slotId}`) as HTMLTextAreaElement
    expect(field.value).toBe('')
    expect((container.querySelector('[data-slot-id] textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('a known file opens in the write step with its slots and values; typing in a field shows on the page and vice versa; Save persists', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const sonner = await import('sonner')
    const success = vi.spyOn(sonner.toast, 'success')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))

    const dateField = await waitFor(() => screen.getByTestId('slot-field-s2') as HTMLTextAreaElement)
    expect(dateField.value).toBe('07/11/2024')
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

  it('typing in the write step is saved on its own after ~1s, without pressing Save', async () => {
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

  it('Back returns to the layout step with slots unlocked; Next again keeps the typed values', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: knownFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    fireEvent.change(screen.getByTestId('slot-field-s1'), { target: { value: '001' } })

    fireEvent.click(screen.getByTestId('panel-back'))
    await waitFor(() => screen.getByTestId('panel-next'))
    await waitFor(() => expect(store.session()).toEqual({ fileId: 'file-1', step: 'layout' }))
    const box = await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s1"]')
      if (!el) throw new Error('overlay not mounted yet')
      return el as HTMLElement
    })
    expect(box.style.cursor).toBe('move')
    expect(screen.getByTestId('font-select-trigger')).toBeTruthy()

    fireEvent.click(screen.getByTestId('panel-next'))
    await waitFor(() => screen.getByTestId('slot-field-s1'))
    expect((screen.getByTestId('slot-field-s1') as HTMLTextAreaElement).value).toBe('001')
    expect((screen.getByTestId('slot-field-s2') as HTMLTextAreaElement).value).toBe('07/11/2024')
  })

  it('an untouched new file persists nothing -- not after the debounce, not on unmount', async () => {
    // Otherwise an empty layout would be saved for the file, and openFile
    // would treat it as known next time: a locked page with an empty form.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { unmount } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('panel-next'))
    await vi.advanceTimersByTimeAsync(1100)
    unmount()
    expect(store.layouts.size).toBe(0)
    expect(store.values.size).toBe(0)
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

  it('duplicating from a chip adds a second slot with the same settings, named "<name> copy", on the page and in the panel', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const layoutStep: OpenedFile = { ...knownFile, values: null, step: 'layout' }
    const { container } = render(createElement(TemplateEditor, { opened: layoutStep, store, onStartOver: vi.fn() }))
    await waitFor(() => screen.getByTestId('slot-chip-duplicate-s1'))

    fireEvent.click(screen.getByTestId('slot-chip-duplicate-s1'))

    const chips = Array.from(container.querySelectorAll('[data-testid^="slot-chip-"]:not([data-testid^="slot-chip-remove-"]):not([data-testid^="slot-chip-duplicate-"])'))
    expect(chips.map((c) => c.textContent)).toEqual(['CO#', 'Date', 'CO# copy'])
    const boxes = Array.from(container.querySelectorAll('[data-slot-id]'))
    expect(boxes).toHaveLength(3)
    // The copy keeps the source's width and is selected.
    const source = boxes[0] as HTMLElement
    const copy = boxes[2] as HTMLElement
    expect(copy.style.width).toBe(source.style.width)
    expect(copy.dataset.slotId).not.toBe(source.dataset.slotId)
    expect(copy.style.outline).toContain('var(--slot-selection)')

    // A second duplicate of the same source is numbered, not "copy copy".
    fireEvent.click(screen.getByTestId('slot-chip-duplicate-s1'))
    const names = Array.from(container.querySelectorAll('[data-testid^="slot-chip-"]:not([data-testid^="slot-chip-remove-"]):not([data-testid^="slot-chip-duplicate-"])')).map((c) => c.textContent)
    expect(names).toEqual(['CO#', 'Date', 'CO# copy', 'CO# copy (2)'])

    // Next persists the copies with their own names.
    fireEvent.click(screen.getByTestId('panel-next'))
    await waitFor(() => expect(store.layouts.get('file-1')?.slots).toHaveLength(4))
    expect(store.layouts.get('file-1')!.slots.map((s) => s.name)).toEqual(['CO#', 'Date', 'CO# copy', 'CO# copy (2)'])
  })
})
