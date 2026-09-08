import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'
import { Toolbar, type ToolbarProps } from '../src/features/editor/toolbar/Toolbar'

function makeDoc(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    id: 'doc-1',
    source: new Uint8Array([1, 2, 3]),
    pages: [{ width: 612, height: 792 }],
    ...overrides,
  }
}

function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 's1',
    page: 0,
    x: 0,
    y: 0,
    width: 200,
    text: 'hi',
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
    ...overrides,
  }
}

function baseProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  const doc = makeDoc()
  return {
    doc,
    bytes: null,
    isRendering: false,
    slots: [],
    selectedId: null,
    updateSlot: vi.fn(),
    removeSlot: vi.fn(),
    onCommit: vi.fn(),
    zoom: 1,
    onZoomChange: vi.fn(),
    onFitWidth: vi.fn(),
    pageIndex: 0,
    pageCount: doc.pages.length,
    onPageChange: vi.fn(),
    ...overrides,
  }
}

afterEach(() => cleanup())

/**
 * download() must save exactly the bytes it already holds -- never a fresh
 * render, never a copy that could silently drift from what's on screen. See
 * task-16-brief.md's Ruling R-15 and "Do not regenerate on download".
 */
describe('Toolbar download', () => {
  let anchorClick: () => void
  let capturedBlobParts: unknown[] | null
  let createObjectURL: (obj: Blob | MediaSource) => string
  let revokeObjectURL: (url: string) => void

  beforeEach(() => {
    capturedBlobParts = null
    anchorClick = vi.fn<() => void>()
    createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:fake-url')
    revokeObjectURL = vi.fn<(url: string) => void>()

    // Extend (rather than replace) the real URL class: jsdom's anchor
    // element internally relies on a working URL constructor when `.href`
    // is assigned, and a naive `{ ...URL, ... }` object stub isn't callable
    // with `new`, breaking that unrelated path with a confusing error.
    class FakeURL extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    }
    vi.stubGlobal('URL', FakeURL)

    class FakeBlob {
      parts: unknown[]
      type?: string
      constructor(parts: unknown[], options?: { type?: string }) {
        this.parts = parts
        this.type = options?.type
        capturedBlobParts = parts
      }
    }
    vi.stubGlobal('Blob', FakeBlob)

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = anchorClick
      return el
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saves exactly the array it was given -- the same reference, not a copy or a re-derivation', () => {
    const bytes = new Uint8Array([5, 6, 7])
    render(createElement(Toolbar, baseProps({ bytes })))

    fireEvent.click(screen.getByTestId('download-button'))

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(bytes)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('falls back to doc.source when nothing has been committed yet -- an unedited upload is still a legitimate download', () => {
    const doc = makeDoc({ source: new Uint8Array([9, 9, 9]) })
    render(createElement(Toolbar, baseProps({ doc, bytes: null })))

    const button = screen.getByTestId('download-button') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    fireEvent.click(button)

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(doc.source)
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })
})

/**
 * Standing requirement: every control here must actually be wired to
 * updateSlot/removeSlot + a commit, not just change its own local
 * appearance. These tests fail if a control is stubbed to a no-op -- see
 * task-17-report.md for the confirmed red-then-green run.
 */
describe('Toolbar controls act on the selected slot', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables every per-slot control when nothing is selected', () => {
    render(createElement(Toolbar, baseProps({ slots: [makeSlot()], selectedId: null })))

    expect((screen.getByTestId('font-select-trigger') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('size-select-trigger') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('color-trigger') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('align-left') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('align-center') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('align-right') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('delete-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('changing the font select calls updateSlot with the new fontId and commits', async () => {
    const updateSlot = vi.fn()
    const onCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', fontId: 'sans' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlot, onCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('font-select-trigger'))
    const option = await waitFor(() => screen.getByTestId('font-option-serif'))
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => expect(updateSlot).toHaveBeenCalledWith('target-slot', { fontId: 'serif' }))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('clicking an alignment option calls updateSlot with the new align and commits', () => {
    const updateSlot = vi.fn()
    const onCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', align: 'left' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlot, onCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('align-center'))

    expect(updateSlot).toHaveBeenCalledWith('target-slot', { align: 'center' })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('clicking delete calls removeSlot with the selected id and commits', () => {
    const removeSlot = vi.fn()
    const onCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, removeSlot, onCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('delete-button'))

    expect(removeSlot).toHaveBeenCalledWith('target-slot')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('choosing a colour swatch calls updateSlot with that RGB and commits', () => {
    const updateSlot = vi.fn()
    const onCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', color: { r: 0, g: 0, b: 0 } })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlot, onCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('color-trigger'))
    fireEvent.click(screen.getByTestId('color-swatch-blue'))

    expect(updateSlot).toHaveBeenCalledWith('target-slot', { color: { r: 37, g: 99, b: 235 } })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})

describe('Toolbar zoom and page navigation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zoom in/out call onZoomChange with the stepped, clamped value', () => {
    const onZoomChange = vi.fn()
    render(createElement(Toolbar, baseProps({ zoom: 1, onZoomChange })))

    fireEvent.click(screen.getByTestId('zoom-in'))
    expect(onZoomChange).toHaveBeenCalledWith(1.25)

    fireEvent.click(screen.getByTestId('zoom-out'))
    expect(onZoomChange).toHaveBeenCalledWith(0.75)
  })

  it('shows the zoom percentage and calls onFitWidth from the fit-width button', () => {
    const onFitWidth = vi.fn()
    render(createElement(Toolbar, baseProps({ zoom: 1.5, onFitWidth })))

    expect(screen.getByTestId('zoom-percentage').textContent).toBe('150%')

    fireEvent.click(screen.getByTestId('zoom-fit-width'))
    expect(onFitWidth).toHaveBeenCalledTimes(1)
  })

  it('hides page navigation entirely for a single-page document', () => {
    render(createElement(Toolbar, baseProps({ pageCount: 1 })))

    expect(screen.queryByTestId('page-controls')).toBeNull()
  })

  it('shows "N of M" and calls onPageChange for a multi-page document', () => {
    const onPageChange = vi.fn()
    render(createElement(Toolbar, baseProps({ pageIndex: 0, pageCount: 3, onPageChange })))

    expect(screen.getByTestId('page-indicator').textContent).toBe('1 of 3')
    expect((screen.getByTestId('page-prev') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('page-next'))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })
})
