import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * Wiring tests for the guarantee this task exists to deliver: after a
 * commit, the *actual rendered PDF bytes* -- not doc.source -- are what
 * PageCanvas paints, and the slot whose text was just committed stops
 * showing its own DOM approximation of that text.
 *
 * Unlike commitAndDownloadPipeline.test.ts (which builds its own minimal
 * Harness around useCommitRender + Toolbar), this renders the REAL Editor
 * and REAL SlotOverlay, driven the way a user actually would: click the
 * canvas, type, blur. A prior review confirmed this was the missing case --
 * reverting any of Editor.tsx's `bytes={doc.source}`, its `textCommitted`
 * prop, or its `onCommit={handleCommit}` wiring left every other test in
 * the suite green.
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
// Mirrors packages/core/src/fonts/registry.ts's FONT_FILES -- kept as a
// literal here (rather than importing the real module) so this fixture
// doesn't depend on @pdf-slot/core's mock above resolving first.
const FONT_FILES = [
  'PT_Sans-Web-Regular.ttf',
  'PT_Sans-Web-Bold.ttf',
  'PT_Serif-Web-Regular.ttf',
  'PT_Serif-Web-Bold.ttf',
  'IBMPlexMono-Regular.ttf',
]

function makeDoc(): EditorDocument {
  return { id: 'doc-1', source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
}

/** Renders Editor, places one slot via a real click, types real text into it. */
async function placeAndTypeIntoASlot(container: HTMLElement, text = 'Hello world') {
  const canvas = await waitFor(() => {
    const el = container.querySelector('canvas')
    if (!el) throw new Error('canvas not mounted yet')
    return el
  })

  fireEvent.click(canvas, { clientX: 50, clientY: 50 })

  const textarea = await waitFor(() => {
    const el = container.querySelector('textarea')
    if (!el) throw new Error('textarea not mounted yet -- font metrics still loading?')
    return el
  })

  fireEvent.change(textarea, { target: { value: text } })
  return textarea
}

/**
 * These run Editor in verification mode (`renderOnCommit: true`): every
 * commit renders the real PDF and the canvas paints it. Off by default
 * in the product (the overlay is the preview; one render on download),
 * this mode is how the overlay is proven equal to the output.
 */
describe('Editor wiring: commit makes the canvas (not doc.source) the truth', () => {
  beforeEach(() => {
    renderPdfMock.mockReset()
    renderPdfIncrementalMock.mockReset()
    renderPdfIncrementalMock.mockImplementation(
      async (previous, slots) => new Uint8Array([...previous, slots.length]),
    )
    getDocumentMock.mockReset()

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

    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        })),
      }),
      destroy: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('tells the user when the fonts fail to load, instead of only logging', async () => {
    // Without metrics, Editor renders no SlotOverlay at all: clicking the
    // page creates slots that are invisible and untypeable. A console.error
    // is not a signal a user can see.
    //
    // Declared FIRST in this file on purpose: loadFontBytes() memoises the
    // successful fetch in a module-level cache that outlives `cleanup()`,
    // so a later test could never observe a failing fetch. It resets that
    // cache on rejection, so the tests below still load fonts normally.
    const { Editor } = await import('../src/features/editor/Editor')
    const sonner = await import('sonner')
    const errorSpy = vi.spyOn(sonner.toast, 'error')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const doc = makeDoc()
    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))

    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    expect(String(errorSpy.mock.calls.at(-1)?.[0])).toMatch(/fonts/i)
    // And the symptom really is what the message claims: no overlay.
    expect(container.querySelector('textarea')).toBeNull()

    consoleSpy.mockRestore()
  })

  it('feeds PageCanvas the rendered bytes, not doc.source, once a commit lands', async () => {
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
    const renderedOutput = new Uint8Array([9, 9, 9, 9, 9])
    renderPdfMock.mockResolvedValue(renderedOutput)

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))

    const textarea = await placeAndTypeIntoASlot(container)
    fireEvent.blur(textarea)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    await waitFor(() => {
      const lastCall = getDocumentMock.mock.calls.at(-1)
      if (!lastCall) throw new Error('pdf.js getDocument not called yet')
      const data = (lastCall[0] as { data: Uint8Array }).data
      // doc.source is [1, 2, 3] -- distinct from renderedOutput, so this
      // fails loudly (comparing against the wrong bytes) if Editor ever
      // goes back to feeding PageCanvas doc.source after a commit.
      expect(Array.from(data)).toEqual(Array.from(renderedOutput))
    })
  })

  it('blocks download and names the offending characters for unsupported text', async () => {
    // Spec §8's export gate, end to end through the real Editor. pdf-lib
    // does NOT raise on this input -- it would draw .notdef boxes and save
    // happily -- so if Editor doesn't check, nothing does.
    const { Editor } = await import('../src/features/editor/Editor')
    const sonner = await import('sonner')
    const errorSpy = vi.spyOn(sonner.toast, 'error')

    const doc = makeDoc()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))
    const textarea = await placeAndTypeIntoASlot(container, 'Hello 日本語')

    // The button is `aria-disabled`, not natively `disabled` -- see the
    // `downloadBlockedReason` doc comment on ToolbarProps: a native
    // `disabled` attribute would make the button unfocusable and suppress
    // pointer events, so the Tooltip explaining the block could never open.
    const downloadButton = await waitFor(() => {
      const el = container.querySelector('[data-testid="download-button"]') as HTMLButtonElement
      if (el.getAttribute('aria-disabled') !== 'true') throw new Error('download not blocked yet')
      return el
    })
    expect(downloadButton.getAttribute('aria-disabled')).toBe('true')

    const message = errorSpy.mock.calls.at(-1)?.[0]
    expect(typeof message).toBe('string')
    expect(message).toContain('日')
    expect(message).toContain('本')
    expect(message).toContain('語')

    // And it clears the moment the text is fixed.
    fireEvent.change(textarea, { target: { value: 'Hello world' } })
    await waitFor(() => {
      const el = container.querySelector('[data-testid="download-button"]') as HTMLButtonElement
      expect(el.getAttribute('aria-disabled')).toBe('false')
    })
  })

  it('blocks download for a pasted tab character', async () => {
    // The ordinary path into this: pasting a cell out of a spreadsheet.
    // The textarea shows a tab stop; the PDF would show a .notdef box.
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))
    await placeAndTypeIntoASlot(container, 'Name\tValue')

    await waitFor(() => {
      const el = container.querySelector('[data-testid="download-button"]') as HTMLButtonElement
      expect(el.getAttribute('aria-disabled')).toBe('true')
    })
  })

  it('leaves download alone for Latin and Cyrillic text across several lines', async () => {
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))
    // Newlines share the CJK case's glyph id 0 but are consumed by
    // layoutText and never drawn, so they must not block anything.
    const textarea = await placeAndTypeIntoASlot(container, 'Привет мир\nHello world')
    fireEvent.blur(textarea)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))
    const el = container.querySelector('[data-testid="download-button"]') as HTMLButtonElement
    expect(el.getAttribute('aria-disabled')).toBe('false')
  })

  it('hides the committed slot\'s own DOM text once the canvas has painted it', async () => {
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
    renderPdfMock.mockResolvedValue(new Uint8Array([9, 9, 9]))

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))

    const textarea = await placeAndTypeIntoASlot(container)
    fireEvent.blur(textarea)

    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    const slotDiv = container.querySelector('[data-slot-id]')
    expect(slotDiv).not.toBeNull()

    await waitFor(() => {
      expect(slotDiv?.querySelectorAll('span').length).toBe(0)
    })
  })

  it('keeps an untouched slot on the canvas while another slot\'s commit is still painting', async () => {
    // Between a commit's bytes landing and pdf.js finishing painting them,
    // the canvas still shows the *previous* render. A slot that did not
    // change between the two is drawn correctly on that canvas already --
    // re-showing its DOM text for the duration is a double-struck blink
    // of every committed slot on every commit. Only the slot whose own
    // content changed has anything to show in that window.
    const { Editor } = await import('../src/features/editor/Editor')

    const doc = makeDoc()
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

    const { container } = render(createElement(Editor, { doc, renderOnCommit: true }))

    // Slot A: place, type, commit, and wait until the canvas shows it.
    const textareaA = await placeAndTypeIntoASlot(container, 'first')
    fireEvent.blur(textareaA)
    const slotA = textareaA.closest('[data-slot-id]') as HTMLElement
    await waitFor(() => expect(slotA.querySelectorAll('span').length).toBe(0))

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
    expect(slotB.querySelectorAll('span').length).toBeGreaterThan(0)
    expect(slotA.querySelectorAll('span').length).toBe(0)

    await act(async () => {
      releasePaint!()
    })
    await waitFor(() => expect(slotB.querySelectorAll('span').length).toBe(0))
    expect(slotA.querySelectorAll('span').length).toBe(0)
  })

  it('by default a commit renders nothing -- the one render happens on Download', async () => {
    // The product mode (2026-09-12 direction): editing costs nothing, the
    // overlay stays the preview, and pressing Download performs the single
    // render of the current slots.
    const { Editor } = await import('../src/features/editor/Editor')
    const doc = makeDoc()
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

    const { container } = render(createElement(Editor, { doc }))
    const textarea = await placeAndTypeIntoASlot(container, 'typed')
    fireEvent.blur(textarea)
    await act(async () => {
      await Promise.resolve()
    })
    expect(renderPdfMock).not.toHaveBeenCalled()
    // The overlay keeps showing the text: nothing else could.
    const slotDiv = textarea.closest('[data-slot-id]') as HTMLElement
    expect(slotDiv.querySelectorAll('span').length).toBeGreaterThan(0)

    fireEvent.click(container.querySelector('[data-testid="download-button"]') as HTMLButtonElement)
    await waitFor(() => expect(captured.blobParts).not.toBeNull())
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfMock.mock.calls[0]![1][0]!.text).toBe('typed')
    expect(captured.blobParts?.[0]).toBe(renderedOutput)
  })

  it('with onPlaceSlot, a canvas click asks the parent instead of adding a slot', async () => {
    const { Editor } = await import('../src/features/editor/Editor')
    const onPlaceSlot = vi.fn()
    const { container } = render(createElement(Editor, { doc: makeDoc(), onPlaceSlot }))
    const canvas = await waitFor(() => container.querySelector('canvas') as HTMLCanvasElement)
    fireEvent.click(canvas, { clientX: 50, clientY: 50 })
    expect(onPlaceSlot).toHaveBeenCalledTimes(1)
    expect(onPlaceSlot.mock.calls[0]![1]).toBe(0)
    expect(container.querySelector('[data-slot-id]')).toBeNull()
  })

  it('locked: canvas clicks place nothing and slots render locked', async () => {
    const { Editor } = await import('../src/features/editor/Editor')
    const { useEditorStore } = await import('../src/features/editor/state/useEditorStore')
    function Harness() {
      const store = useEditorStore([{
        id: 's1', page: 0, x: 50, y: 700, width: 200, text: '', fontId: 'sans', size: 14,
        color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
      }])
      return createElement(Editor, { doc: makeDoc(), store, locked: true, highlighted: true })
    }
    const { container } = render(createElement(Harness))
    // Throws while absent: SlotOverlay only mounts once the fonts have
    // loaded, and waitFor retries only on a throw (a returned null would
    // resolve immediately).
    const box = await waitFor(() => {
      const el = container.querySelector('[data-slot-id="s1"]') as HTMLElement | null
      if (!el) throw new Error('slot overlay not mounted yet -- font metrics still loading?')
      return el
    })
    expect(box.style.cursor).toBe('text')
    expect(box.style.backgroundColor).not.toBe('')
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    fireEvent.click(canvas, { clientX: 5, clientY: 5 })
    expect(container.querySelectorAll('[data-slot-id]').length).toBe(1)
    expect(container.querySelector('[data-testid="font-select-trigger"]')).toBeNull()
  })
})
