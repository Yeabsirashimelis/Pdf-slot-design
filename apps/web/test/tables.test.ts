import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFontFixtures } from './helpers/editorFixtures'
import type { EditorDocument, Slot, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import type { OpenSession, SessionStore, TemplateStore } from '@/lib/persistence/templateStore'
import type { OpenedFile } from '@/features/template/openFile'

/**
 * Table row slots, end to end through the real editor: draw the first
 * row, split it into columns, add rows, type into the cells, and export.
 *
 * The point of a table is that nothing is recorded per cell -- so what
 * these check is that the cells follow the table (a column resize moves
 * them all), that the text stays with its cell through it, and that the
 * export draws exactly the cells that were filled in.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return { ...actual, renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args) }
})

vi.mock('pdfjs-dist', async () => {
  const { fakePdfjsDocument } = await import('./helpers/editorFixtures')
  return { GlobalWorkerOptions: {}, getDocument: () => fakePdfjsDocument() }
})

HTMLElement.prototype.setPointerCapture ??= () => {}

function memoryStore() {
  const layouts = new Map<string, TemplateLayout>()
  const values = new Map<string, TemplateValues>()
  let session: OpenSession | null = null
  const store: TemplateStore & SessionStore & { layouts: typeof layouts; values: typeof values } = {
    layouts, values,
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
const newFile: OpenedFile = { doc, name: 'log.pdf', fileId: 'file-1', layout: null, values: null }

/** Draws the first row of a table with the table tool, over the page. */
async function drawTable(container: HTMLElement) {
  fireEvent.click(screen.getByTestId('table-tool'))
  const layer = await waitFor(() => screen.getByTestId('table-draw-layer'))
  // jsdom reports a zero-sized box, so client px are stage px (points).
  fireEvent.pointerDown(layer, { pointerId: 1, clientX: 40, clientY: 100 })
  fireEvent.pointerMove(layer, { pointerId: 1, clientX: 240, clientY: 116 })
  fireEvent.pointerUp(layer, { pointerId: 1 })
  await waitFor(() => expect(container.querySelectorAll('[data-slot-id]').length).toBe(1))
}

const cellBoxes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot-id]')).filter((el) =>
    (el as HTMLElement).dataset.slotId!.includes('#'),
  ) as HTMLElement[]

describe('table row slots', () => {
  beforeEach(() => {
    installFontFixtures()
    renderPdfMock.mockReset()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('drawing a row makes a one-column table; splitting it adds columns that share the width', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await drawTable(container)

    // One row, one column, sized as drawn: 200pt wide, 16pt tall.
    let cells = cellBoxes(container)
    expect(cells).toHaveLength(1)
    expect(cells[0]!.style.left).toBe('40px')
    expect(cells[0]!.style.width).toBe('200px')

    fireEvent.click(screen.getByTestId('table-add-column'))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(2))
    cells = cellBoxes(container)
    // The last column was split in two, so the row is still 200pt wide.
    expect(cells[0]!.style.width).toBe('100px')
    expect(cells[1]!.style.left).toBe('140px')
  })

  it('adding rows repeats the columns down the page at the row gap', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await drawTable(container)
    fireEvent.click(screen.getByTestId('table-add-column'))

    const tableId = cellBoxes(container)[0]!.dataset.slotId!.split('#')[0]!
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(6))

    // Three rows of two, each 16pt below the last (the gap starts as the
    // row's own height, until the second row is dragged onto its line).
    // `top` is screen y from the page's top edge, so it counts downward.
    const tops = cellBoxes(container).map((box) => box.style.top)
    expect(tops).toEqual(['100px', '100px', '116px', '116px', '132px', '132px'])
  })

  it('a column resize moves every cell under it, and the text stays where it was typed', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await drawTable(container)
    fireEvent.click(screen.getByTestId('table-add-column'))
    const tableId = cellBoxes(container)[0]!.dataset.slotId!.split('#')[0]!
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(4))

    // Type into the second row's second column.
    const target = cellBoxes(container)[3]!
    fireEvent.change(target.querySelector('textarea')!, { target: { value: '1,200.00' } })

    // Widen the first column by 40pt through the inspector.
    const widthField = await waitFor(() => container.querySelector('[data-testid^="table-column-width-"]') as HTMLInputElement)
    fireEvent.change(widthField, { target: { value: '140' } })
    fireEvent.keyDown(widthField, { key: 'Enter' })

    await waitFor(() => expect(cellBoxes(container)[1]!.style.left).toBe('180px'))
    // Same cell, same text, new place.
    const moved = cellBoxes(container)[3]!
    expect(moved.style.left).toBe('180px')
    expect((moved.querySelector('textarea') as HTMLTextAreaElement).value).toBe('1,200.00')
  })

  it('removing a row drops a line: the rows below move up and keep their text', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await drawTable(container)
    const tableId = cellBoxes(container)[0]!.dataset.slotId!.split('#')[0]!
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(3))

    const texts = ['first', 'second', 'third']
    cellBoxes(container).forEach((box, i) => {
      fireEvent.change(box.querySelector('textarea')!, { target: { value: texts[i]! } })
    })
    await waitFor(() => expect(screen.getByTestId(`table-row-preview-${tableId}-2`).textContent).toBe('third'))

    fireEvent.click(screen.getByTestId(`table-remove-row-${tableId}-1`))

    await waitFor(() => expect(cellBoxes(container)).toHaveLength(2))
    expect(cellBoxes(container).map((b) => (b.querySelector('textarea') as HTMLTextAreaElement).value)).toEqual([
      'first',
      'third',
    ])
  })

  it('saves the table rather than its cells, and opens again with both', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container, unmount } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await drawTable(container)
    const tableId = cellBoxes(container)[0]!.dataset.slotId!.split('#')[0]!
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(2))
    fireEvent.change(cellBoxes(container)[1]!.querySelector('textarea')!, { target: { value: 'kept' } })

    fireEvent.click(screen.getByTestId('panel-save'))
    await waitFor(() => expect(store.layouts.get('file-1')?.tables).toHaveLength(1))

    const saved = store.layouts.get('file-1')!
    // The cells are derived, so they are not written down as slots.
    expect(saved.slots).toEqual([])
    expect(saved.tables![0]).toMatchObject({ rowCount: 2, x: 40 })
    expect(Object.values(store.values.get('file-1')!.values)).toEqual(['kept'])

    unmount()
    const reopened: OpenedFile = { ...newFile, layout: saved, values: store.values.get('file-1')! }
    const second = render(createElement(TemplateEditor, { opened: reopened, store, onStartOver: vi.fn() }))
    await waitFor(() => expect(cellBoxes(second.container)).toHaveLength(2))
    expect((cellBoxes(second.container)[1]!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('kept')
  })

  it('the export draws the cells that were filled in, and nothing for the empty ones', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    class FakeURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:fake')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', FakeURL)
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} })
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = vi.fn()
      return el
    })

    const { container } = render(createElement(TemplateEditor, { opened: newFile, store: memoryStore(), onStartOver: vi.fn() }))
    await drawTable(container)
    const tableId = cellBoxes(container)[0]!.dataset.slotId!.split('#')[0]!
    fireEvent.click(screen.getByTestId(`table-add-row-${tableId}`))
    await waitFor(() => expect(cellBoxes(container)).toHaveLength(2))
    fireEvent.change(cellBoxes(container)[0]!.querySelector('textarea')!, { target: { value: 'Row one' } })
    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    const drawn = renderPdfMock.mock.calls[0]![1]
    expect(drawn).toHaveLength(2)
    expect(drawn.map((s) => s.text)).toEqual(['Row one', ''])
    // Both cells are ordinary slots on the page, at the table's geometry.
    expect(drawn[0]).toMatchObject({ page: 0, x: 40, y: 692, width: 200 })
  })
})
