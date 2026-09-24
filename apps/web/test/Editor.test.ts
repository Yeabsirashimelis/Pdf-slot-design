import { createElement, useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakePdfjsDocument, installFontFixtures } from './helpers/editorFixtures'
import type { EditorDocument, Point, Slot } from '@pdf-slot/core'

/**
 * Wiring tests for the workspace, driven the way a user actually would:
 * click the page, type, blur, press keys. The guarantee at the centre of
 * them: after a commit, the *actual rendered PDF bytes* -- not doc.source
 * -- are what PageCanvas paints, and the slot whose text was just
 * committed stops showing its own DOM approximation of that text.
 *
 * The Harness is what TemplateEditor does around Editor, minus the
 * panels: a real store, the real pipeline (fonts, commit → render), and
 * the naming/placement callbacks a parent supplies.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
// After a first output exists, later renders are increments on top of it
// (see useCommitRender). Mocked to hand back fresh bytes per call so a
// second commit in these tests produces a distinct `bytes` value.
const renderPdfIncrementalMock =
  vi.fn<(previous: Uint8Array, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()

vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return {
    ...actual,
    renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
    renderPdfIncremental: (...args: Parameters<typeof renderPdfIncrementalMock>) =>
      renderPdfIncrementalMock(...args),
  }
})

// pdf.js is mocked at the same seam as usePdfDocument.test.ts: this suite
// cares about what bytes Editor hands to PageCanvas (and when pdf.js
// confirms painting them), not about actually drawing pixels in jsdom.
const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

// jsdom doesn't implement the Pointer Capture API used by SlotOverlay.
HTMLElement.prototype.setPointerCapture ??= () => {}

function makeDoc(pages = 1): EditorDocument {
  return {
    id: 'doc-1',
    source: new Uint8Array([1, 2, 3]),
    pages: Array.from({ length: pages }, () => ({ width: 612, height: 792 })),
  }
}

type HarnessProps = {
  doc: EditorDocument
  initialSlots?: Slot[]
  renderOnCommit?: boolean
  locked?: boolean
  /** Records the placements instead of adding slots, when given. */
  onPlaceSlot?: (atPdf: Point, page: number) => void
  onRemoveSlot?: (id: string) => void
  onDuplicateSlot?: (id: string) => void
}

/** The workspace with a real store and pipeline; placing a slot names it "Field". */
async function makeHarness() {
  const { Editor } = await import('../src/features/editor/Editor')
  const { useEditorStore } = await import('../src/features/editor/state/useEditorStore')
  const { useEditorPipeline } = await import('../src/features/editor/useEditorPipeline')
  return function Harness({
    doc,
    initialSlots = [],
    renderOnCommit = false,
    locked = false,
    onPlaceSlot,
    onRemoveSlot,
    onDuplicateSlot,
  }: HarnessProps) {
    const store = useEditorStore(initialSlots)
    const pipeline = useEditorPipeline(doc, store, { renderOnCommit })
    const [pageIndex, setPageIndex] = useState(0)
    return createElement(Editor, {
      doc,
      store,
      pipeline,
      pageIndex,
      onPageChange: setPageIndex,
      locked,
      names: Object.fromEntries(store.slots.map((s) => [s.id, 'Field'])),
      onPlaceSlot: onPlaceSlot ?? ((atPdf, page) => store.addSlot(atPdf, page)),
      onRemoveSlot: onRemoveSlot ?? ((id) => pipeline.removeSlotAndCommit(id)),
      onDuplicateSlot: onDuplicateSlot ?? ((id) => pipeline.duplicateSlotAndCommit(id)),
      onPasteSlot: (snapshot, _label, target) => pipeline.pasteSlotAndCommit(snapshot, target),
    })
  }
}

/** Places one slot via a real click on the page, types real text into it. */
async function placeAndTypeIntoASlot(container: HTMLElement, text = 'Hello world') {
  const canvas = await waitFor(() => {
    const el = container.querySelector('canvas')
    if (!el) throw new Error('canvas not mounted yet')
    return el
  })

  fireEvent.click(canvas, { clientX: 50, clientY: 50 })

  const textarea = await waitFor(() => {
    const els = container.querySelectorAll('textarea')
    const el = els[els.length - 1]
    if (!el) throw new Error('textarea not mounted yet -- font metrics still loading?')
    return el as HTMLTextAreaElement
  })

  fireEvent.change(textarea, { target: { value: text } })
  return textarea
}

describe('Editor wiring: commit makes the canvas (not doc.source) the truth', () => {
  beforeEach(() => {
    renderPdfMock.mockReset()
    renderPdfIncrementalMock.mockReset()
    renderPdfIncrementalMock.mockImplementation(
      async (previous, slots) => new Uint8Array([...previous, slots.length]),
    )
    getDocumentMock.mockReset()

    installFontFixtures()
    getDocumentMock.mockReturnValue(fakePdfjsDocument())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('tells the user when the fonts fail to load, instead of only logging', async () => {
    // Without metrics, the workspace renders no SlotOverlay at all:
    // clicking the page creates slots that are invisible and untypeable.
    // A console.error is not a signal a user can see.
    //
    // Declared FIRST in this file on purpose: loadFontBytes() memoises the
    // successful fetch in a module-level cache that outlives `cleanup()`,
    // so a later test could never observe a failing fetch. It resets that
    // cache on rejection, so the tests below still load fonts normally.
    const Harness = await makeHarness()
    const sonner = await import('sonner')
    const errorSpy = vi.spyOn(sonner.toast, 'error')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const { container } = render(createElement(Harness, { doc: makeDoc(), renderOnCommit: true }))

    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    expect(String(errorSpy.mock.calls.at(-1)?.[0])).toMatch(/fonts/i)
    // And the symptom really is what the message claims: no overlay.
    expect(container.querySelector('textarea')).toBeNull()

    consoleSpy.mockRestore()
  })

  it('feeds PageCanvas the rendered bytes, not doc.source, once a commit lands', async () => {
    const Harness = await makeHarness()
    const renderedOutput = new Uint8Array([9, 9, 9, 9, 9])
    renderPdfMock.mockResolvedValue(renderedOutput)

    const { container } = render(createElement(Harness, { doc: makeDoc(), renderOnCommit: true }))

    const textarea = await placeAndTypeIntoASlot(container)
    fireEvent.blur(textarea)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    await waitFor(() => {
      const lastCall = getDocumentMock.mock.calls.at(-1)
      if (!lastCall) throw new Error('pdf.js getDocument not called yet')
      const data = (lastCall[0] as { data: Uint8Array }).data
      // doc.source is [1, 2, 3] -- distinct from renderedOutput, so this
      // fails loudly (comparing against the wrong bytes) if the workspace
      // ever goes back to feeding PageCanvas doc.source after a commit.
      expect(Array.from(data)).toEqual(Array.from(renderedOutput))
    })
  })

  it('hides the committed slot\'s own DOM text once the canvas has painted it', async () => {
    const Harness = await makeHarness()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Harness, { doc: makeDoc(), renderOnCommit: true }))

    const textarea = await placeAndTypeIntoASlot(container)
    fireEvent.blur(textarea)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    const slotDiv = container.querySelector('[data-slot-id]')
    expect(slotDiv).not.toBeNull()

    await waitFor(() => {
      expect(slotDiv?.querySelectorAll('[data-slot-line]').length).toBe(0)
    })
  })

  it('keeps an untouched slot on the canvas while another slot\'s commit is still painting', async () => {
    // Between a commit's bytes landing and pdf.js finishing painting them,
    // the canvas still shows the *previous* render. A slot that did not
    // change between the two is drawn correctly on that canvas already --
    // re-showing its DOM text for the duration is a double-struck blink
    // of every committed slot on every commit. Only the slot whose own
    // content changed has anything to show in that window.
    const Harness = await makeHarness()
    renderPdfMock.mockResolvedValue(new Uint8Array([7, 7]))

    // Paints: #1 is doc.source on mount, #2 slot A's commit, #3 slot B's.
    // From the third on, the paint is held open until released.
    let releasePaint: (() => void) | null = null
    let paints = 0
    getDocumentMock.mockImplementation(() => ({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => {
            paints += 1
            const promise =
              paints < 3
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                    releasePaint = resolve
                  })
            return { promise, cancel: vi.fn() }
          },
        })),
      }),
      destroy: vi.fn(),
    }))

    const { container } = render(createElement(Harness, { doc: makeDoc(), renderOnCommit: true }))

    // Slot A: place, type, commit, and wait until the canvas shows it.
    const textareaA = await placeAndTypeIntoASlot(container, 'first')
    fireEvent.blur(textareaA)
    const slotA = textareaA.closest('[data-slot-id]') as HTMLElement
    await waitFor(() => expect(slotA.querySelectorAll('[data-slot-line]').length).toBe(0))

    // Slot B: place and commit. Its paint is now held open.
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    fireEvent.click(canvas, { clientX: 200, clientY: 200 })
    const textareaB = await waitFor(() => {
      const all = container.querySelectorAll('textarea')
      if (all.length < 2) throw new Error('second slot not mounted yet')
      return all[1] as HTMLTextAreaElement
    })
    fireEvent.change(textareaB, { target: { value: 'second' } })
    fireEvent.blur(textareaB)
    await waitFor(() => expect(renderPdfIncrementalMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(releasePaint).not.toBeNull())

    // Mid-paint: B (changed) shows its DOM text; A (unchanged) must not.
    const slotB = textareaB.closest('[data-slot-id]') as HTMLElement
    expect(slotB.querySelectorAll('[data-slot-line]').length).toBeGreaterThan(0)
    expect(slotA.querySelectorAll('[data-slot-line]').length).toBe(0)

    await act(async () => {
      releasePaint!()
    })
    await waitFor(() => expect(slotB.querySelectorAll('[data-slot-line]').length).toBe(0))
    expect(slotA.querySelectorAll('[data-slot-line]').length).toBe(0)
  })

  it('by default a commit renders nothing -- the overlay stays the preview', async () => {
    // The product mode (2026-09-12 direction): editing costs nothing, the
    // overlay stays the preview, and the single render happens on Download
    // (see TemplateEditor.test.ts for that half).
    const Harness = await makeHarness()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Harness, { doc: makeDoc() }))
    const textarea = await placeAndTypeIntoASlot(container, 'typed')
    fireEvent.blur(textarea)
    await act(async () => {
      await Promise.resolve()
    })
    expect(renderPdfMock).not.toHaveBeenCalled()
    // The overlay keeps showing the text: nothing else could.
    const slotDiv = textarea.closest('[data-slot-id]') as HTMLElement
    expect(slotDiv.querySelectorAll('[data-slot-line]').length).toBeGreaterThan(0)
  })
})

describe('Editor workspace: placing, locking, panning, keys', () => {
  beforeEach(() => {
    renderPdfMock.mockReset()
    getDocumentMock.mockReset()
    installFontFixtures()
    getDocumentMock.mockReturnValue(fakePdfjsDocument())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const seeded: Slot = {
    id: 's1', page: 0, x: 50, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
    color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
  }

  async function mountedSlot(container: HTMLElement, id = 's1') {
    // Throws while absent: SlotOverlay only mounts once the fonts have
    // loaded, and waitFor retries only on a throw.
    return waitFor(() => {
      const el = container.querySelector(`[data-slot-id="${id}"]`) as HTMLElement | null
      if (!el) throw new Error('slot overlay not mounted yet -- font metrics still loading?')
      return el
    })
  }

  it('a click on the page reports a PDF point -- stage px are points, y flipped from the page bottom', async () => {
    const Harness = await makeHarness()
    const onPlaceSlot = vi.fn()
    const { container } = render(createElement(Harness, { doc: makeDoc(2), onPlaceSlot }))
    const canvas = await waitFor(() => container.querySelector('canvas') as HTMLCanvasElement)
    // jsdom reports a zero rect, so client coords are stage coords.
    fireEvent.click(canvas, { clientX: 50, clientY: 30 })
    expect(onPlaceSlot).toHaveBeenCalledWith({ x: 50, y: 792 - 30 }, 0)
    expect(container.querySelector('[data-slot-id]')).toBeNull()
  })

  it('locked: clicks place nothing and slots render locked', async () => {
    const Harness = await makeHarness()
    const onPlaceSlot = vi.fn()
    const { container } = render(createElement(Harness, { doc: makeDoc(), initialSlots: [seeded], locked: true, onPlaceSlot }))
    const box = await mountedSlot(container)
    expect(box.style.cursor).toBe('text')
    fireEvent.click(container.querySelector('canvas') as HTMLCanvasElement, { clientX: 5, clientY: 5 })
    expect(onPlaceSlot).not.toHaveBeenCalled()
  })

  it('shows the name as the placeholder of an empty box, and nothing else over the page', async () => {
    const Harness = await makeHarness()
    const { container } = render(createElement(Harness, { doc: makeDoc(), initialSlots: [seeded] }))
    const box = await mountedSlot(container)
    expect(box.querySelector('[data-slot-line][data-placeholder]')?.textContent).toBe('Field')
    // Selecting it adds no badge over the page: the size is in the panel.
    fireEvent.focus(box.querySelector('textarea') as HTMLTextAreaElement)
    await waitFor(() => expect(box.querySelector('[data-resize-edge]')).not.toBeNull())
    expect(box.querySelector('[data-testid="slot-size-badge"]')).toBeNull()
  })

  it('space held: a shield covers the slots so a drag pans, and a click places nothing', async () => {
    const Harness = await makeHarness()
    const onPlaceSlot = vi.fn()
    const { container } = render(createElement(Harness, { doc: makeDoc(), initialSlots: [seeded], onPlaceSlot }))
    await mountedSlot(container)
    expect(container.querySelector('[data-testid="pan-shield"]')).toBeNull()
    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(() => expect(container.querySelector('[data-testid="pan-shield"]')).not.toBeNull())
    expect((container.querySelector('[data-testid="workspace"]') as HTMLElement).style.cursor).toBe('grab')
    fireEvent.click(container.querySelector('canvas') as HTMLCanvasElement, { clientX: 5, clientY: 5 })
    expect(onPlaceSlot).not.toHaveBeenCalled()
    fireEvent.keyUp(window, { key: ' ' })
    await waitFor(() => expect(container.querySelector('[data-testid="pan-shield"]')).toBeNull())
  })

  it('Delete removes the selected slot, Escape deselects; neither while typing', async () => {
    const Harness = await makeHarness()
    const onRemoveSlot = vi.fn()
    const { container } = render(createElement(Harness, { doc: makeDoc(), initialSlots: [seeded], onRemoveSlot }))
    const box = await mountedSlot(container)
    const textarea = box.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.focus(textarea)
    await waitFor(() => expect(box.style.outline).toContain('var(--slot-selection)'))

    // In the field, Delete edits text.
    fireEvent.keyDown(textarea, { key: 'Delete' })
    expect(onRemoveSlot).not.toHaveBeenCalled()

    fireEvent.blur(textarea)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(onRemoveSlot).toHaveBeenCalledWith('s1')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(box.style.outline).toBe('none'))
  })

  it('the zoom pill steps through presets and reports the scale; the page pill turns pages', async () => {
    const Harness = await makeHarness()
    const { container } = render(createElement(Harness, { doc: makeDoc(2) }))
    const workspace = await waitFor(() => container.querySelector('[data-testid="workspace"]') as HTMLElement)
    // jsdom measures nothing, so the fit lands on 100% at the origin.
    await waitFor(() => expect(container.querySelector('[data-testid="zoom-percentage"]')?.textContent).toBe('100%'))
    fireEvent.click(container.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement)
    await waitFor(() => expect(container.querySelector('[data-testid="zoom-percentage"]')?.textContent).toBe('150%'))
    expect(workspace.dataset.zoom).toBe('1.5')
    fireEvent.click(container.querySelector('[data-testid="zoom-out"]') as HTMLButtonElement)
    await waitFor(() => expect(container.querySelector('[data-testid="zoom-percentage"]')?.textContent).toBe('100%'))

    expect(container.querySelector('[data-testid="page-indicator"]')?.textContent).toBe('1 / 2')
    fireEvent.click(container.querySelector('[data-testid="page-next"]') as HTMLButtonElement)
    await waitFor(() => expect(container.querySelector('[data-testid="page-indicator"]')?.textContent).toBe('2 / 2'))
  })

  it('a click on the dark canvas outside the page deselects', async () => {
    const Harness = await makeHarness()
    const { container } = render(createElement(Harness, { doc: makeDoc(), initialSlots: [seeded] }))
    const box = await mountedSlot(container)
    fireEvent.focus(box.querySelector('textarea') as HTMLTextAreaElement)
    await waitFor(() => expect(box.style.outline).toContain('var(--slot-selection)'))
    fireEvent.click(container.querySelector('[data-testid="canvas-backdrop"]') as HTMLElement)
    await waitFor(() => expect(box.style.outline).toBe('none'))
  })
})
