import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'
import { COLOR_SWATCHES, Toolbar, type ToolbarProps } from '../src/features/editor/toolbar/Toolbar'

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
    // Nothing in flight by default. The download path awaits this, so every
    // download assertion below has to await a microtask before the Blob
    // exists -- see the `flush` doc comment on ToolbarProps.
    flush: vi.fn(async () => null),
    downloadBlockedReason: null,
    slots: [],
    selectedId: null,
    updateSlotAndCommit: vi.fn(),
    removeSlotAndCommit: vi.fn(),
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

  it('saves exactly the array it was given -- the same reference, not a copy or a re-derivation', async () => {
    const bytes = new Uint8Array([5, 6, 7])
    render(createElement(Toolbar, baseProps({ bytes })))

    fireEvent.click(screen.getByTestId('download-button'))
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(bytes)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('falls back to doc.source when nothing has been committed yet -- an unedited upload is still a legitimate download', async () => {
    const doc = makeDoc({ source: new Uint8Array([9, 9, 9]) })
    render(createElement(Toolbar, baseProps({ doc, bytes: null })))

    const button = screen.getByTestId('download-button') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(doc.source)
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })
})

/**
 * Standing requirement: every control here must actually be wired to
 * updateSlotAndCommit/removeSlotAndCommit, not just change its own local
 * appearance. These tests fail if a control is stubbed to a no-op -- see
 * task-17-report.md for the confirmed red-then-green run.
 *
 * These are deliberately unit tests with mocked collaborators: they prove
 * the toolbar *calls* updateSlotAndCommit/removeSlotAndCommit with the
 * right arguments, which is a real and necessary guarantee, but NOT proof
 * that a real commit lands the right slots at the right time -- that
 * timing guarantee (the fix-round-1 finding) is covered separately in
 * toolbarCommitTiming.test.ts against the real store + real
 * useCommitRender.
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

  it('changing the font select calls updateSlotAndCommit with the new fontId', async () => {
    const updateSlotAndCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', fontId: 'sans' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlotAndCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('font-select-trigger'))
    const option = await waitFor(() => screen.getByTestId('font-option-serif'))
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() =>
      expect(updateSlotAndCommit).toHaveBeenCalledWith('target-slot', { fontId: 'serif' }),
    )
  })

  it('changing the size select calls updateSlotAndCommit with the new size', async () => {
    const updateSlotAndCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', size: 14 })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlotAndCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('size-select-trigger'))
    const option = await waitFor(() => screen.getByTestId('size-option-24'))
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() =>
      expect(updateSlotAndCommit).toHaveBeenCalledWith('target-slot', { size: 24 }),
    )
  })

  it('clicking an alignment option calls updateSlotAndCommit with the new align', () => {
    const updateSlotAndCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', align: 'left' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlotAndCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('align-center'))

    expect(updateSlotAndCommit).toHaveBeenCalledWith('target-slot', { align: 'center' })
  })

  it('clicking delete calls removeSlotAndCommit with the selected id', () => {
    const removeSlotAndCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot' })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, removeSlotAndCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('delete-button'))

    expect(removeSlotAndCommit).toHaveBeenCalledWith('target-slot')
  })

  it('every swatch is in RGB\'s 0-1 range, not CSS bytes', () => {
    // The palette is the only place in the app where an RGB literal is
    // hand-authored, and it was authored in 0-255 -- which made pdf-lib's
    // rgb() throw on export and the overlay clamp the preview text to
    // white. Asserting the range over the whole list (rather than one
    // swatch's exact value) is what stops a new swatch reintroducing it.
    for (const swatch of COLOR_SWATCHES) {
      for (const component of [swatch.color.r, swatch.color.g, swatch.color.b]) {
        expect(component, swatch.label).toBeGreaterThanOrEqual(0)
        expect(component, swatch.label).toBeLessThanOrEqual(1)
      }
    }
  })

  it('choosing a colour swatch calls updateSlotAndCommit with that RGB', () => {
    const updateSlotAndCommit = vi.fn()
    const slot = makeSlot({ id: 'target-slot', color: { r: 0, g: 0, b: 0 } })
    render(
      createElement(
        Toolbar,
        baseProps({ slots: [slot], selectedId: slot.id, updateSlotAndCommit }),
      ),
    )

    fireEvent.click(screen.getByTestId('color-trigger'))
    fireEvent.click(screen.getByTestId('color-swatch-blue'))

    // 0-1, per RGB's contract -- #2563eb expressed the way pdf-lib's rgb()
    // and the overlay both require, not as CSS bytes.
    expect(updateSlotAndCommit).toHaveBeenCalledWith('target-slot', {
      color: { r: 37 / 255, g: 99 / 255, b: 235 / 255 },
    })
  })
})

describe('Toolbar export gate', () => {
  it('disables Download and explains why when a reason is given', () => {
    render(
      createElement(
        Toolbar,
        baseProps({ downloadBlockedReason: 'The selected font can\'t draw “日”.' }),
      ),
    )

    expect((screen.getByTestId('download-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not build a Blob at all while blocked', async () => {
    const flush = vi.fn(async () => null)
    render(createElement(Toolbar, baseProps({ downloadBlockedReason: 'nope', flush })))

    fireEvent.click(screen.getByTestId('download-button'))
    await Promise.resolve()

    expect(flush).not.toHaveBeenCalled()
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

describe('Toolbar start-over control (Task 18)', () => {
  afterEach(() => cleanup())

  it('omits the control entirely when onStartOver is not provided', () => {
    render(createElement(Toolbar, baseProps()))
    expect(screen.queryByTestId('start-over-button')).toBeNull()
  })

  it('calls onStartOver when clicked', () => {
    const onStartOver = vi.fn()
    render(createElement(Toolbar, baseProps({ onStartOver })))

    fireEvent.click(screen.getByTestId('start-over-button'))

    expect(onStartOver).toHaveBeenCalledTimes(1)
  })
})
