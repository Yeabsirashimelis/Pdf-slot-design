import { createElement, useMemo, useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * End-to-end (within jsdom, at the seam) check of the download pipeline
 * through the real hook and the real Toolbar: Download performs exactly
 * one render of the current slots (from scratch the first time, an
 * increment on top of the last output after that), saves exactly those
 * bytes, and never falls back to the source once the user has edited.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
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

vi.mock('../src/lib/fonts/loadFonts', () => ({
  loadFontBytes: () => Promise.resolve({}),
}))

function makeDoc(): EditorDocument {
  return { id: 'doc-1', source: new Uint8Array([1]), pages: [{ width: 612, height: 792 }] }
}

function makeSlot(): Slot {
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
  }
}

describe('commit -> preview -> download pipeline', () => {
  let capturedBlobParts: unknown[] | null

  beforeEach(() => {
    renderPdfMock.mockReset()
    renderPdfIncrementalMock.mockReset()
    capturedBlobParts = null

    // Extend (rather than replace) the real URL class: jsdom's anchor
    // element internally relies on a working URL constructor when `.href`
    // is assigned, and a naive `{ ...URL, ... }` object stub isn't callable
    // with `new`, breaking that unrelated path with a confusing error.
    class FakeURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:fake-url')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', FakeURL)

    class FakeBlob {
      parts: unknown[]
      constructor(parts: unknown[]) {
        this.parts = parts
        capturedBlobParts = parts
      }
    }
    vi.stubGlobal('Blob', FakeBlob)

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = vi.fn()
      return el
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a first download renders once from scratch; a second one after an edit appends an increment', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { Toolbar } = await import('../src/features/editor/toolbar/Toolbar')

    const output = new Uint8Array([42, 43])
    const outputPlus = new Uint8Array([42, 43, 44])
    renderPdfMock.mockResolvedValue(output)
    renderPdfIncrementalMock.mockResolvedValue(outputPlus)
    const doc = makeDoc()

    function Harness() {
      const [text, setText] = useState('hi')
      const slots = useMemo(() => [{ ...makeSlot(), text }], [text])
      const { isRendering, render } = useCommitRender(doc, slots)
      return createElement(
        'div',
        null,
        createElement('button', { onClick: () => setText('edited'), 'data-testid': 'edit-button' }, 'Edit'),
        createElement(Toolbar, {
          isRendering,
          render,
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
        }),
      )
    }

    const { getByTestId } = render(createElement(Harness))

    // Nothing renders just from mounting.
    expect(renderPdfMock).not.toHaveBeenCalled()

    fireEvent.click(getByTestId('download-button'))
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfMock.mock.calls[0]![1][0]!.text).toBe('hi')
    expect((capturedBlobParts as unknown[])[0]).toBe(output)

    // Same slots, downloaded again: no new render of any kind.
    capturedBlobParts = null
    fireEvent.click(getByTestId('download-button'))
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
    expect(capturedBlobParts?.[0]).toBe(output)

    // Edit, then download: an increment on top of the first output --
    // never a second from-scratch render.
    fireEvent.click(getByTestId('edit-button'))
    capturedBlobParts = null
    fireEvent.click(getByTestId('download-button'))
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock.mock.calls[0]![0]).toBe(output)
    expect(renderPdfIncrementalMock.mock.calls[0]![1][0]!.text).toBe('edited')
    expect(capturedBlobParts?.[0]).toBe(outputPlus)
  })

  it('in verification mode, download clicked in the same interaction as the edit saves the edit, not the source', async () => {
    // Pressing Download blurs the focused textarea; with render-on-commit
    // enabled, blur IS a render, so mousedown starts renderPdf and the
    // click lands a few milliseconds later mid-render. The download must
    // wait for that render (and not start a second one) rather than read
    // a `bytes` that has not caught up.
    //
    // The render is deliberately held open here until after the click, so
    // the click genuinely happens mid-render rather than by luck of
    // microtask ordering.
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { Toolbar } = await import('../src/features/editor/toolbar/Toolbar')

    const edited = new Uint8Array([7, 7, 7])
    const releaseRender: { current: (() => void) | null } = { current: null }
    renderPdfMock.mockImplementation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releaseRender.current = () => resolve(edited)
        }),
    )

    const doc = makeDoc()

    function Harness() {
      const [text, setText] = useState('')
      const slots = useMemo(() => [{ ...makeSlot(), text }], [text])
      const { isRendering, commit, render } = useCommitRender(doc, slots, { renderOnCommit: true })
      return createElement(
        'div',
        null,
        createElement('textarea', {
          'data-testid': 'slot-text',
          value: text,
          onChange: (e: { target: { value: string } }) => setText(e.target.value),
          // Blur is the commit boundary, exactly as SlotOverlay wires it.
          onBlur: commit,
        }),
        createElement(Toolbar, {
          isRendering,
          render,
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
        }),
      )
    }

    const { getByTestId } = render(createElement(Harness))

    const textarea = getByTestId('slot-text') as HTMLTextAreaElement
    textarea.focus()
    fireEvent.change(textarea, { target: { value: 'my text' } })

    // One interaction: pressing the button blurs the textarea (commit
    // starts) and then clicks it.
    const downloadButton = getByTestId('download-button') as HTMLButtonElement
    fireEvent.blur(textarea)
    fireEvent.click(downloadButton)

    // Mid-render: the download must not have resolved to anything yet.
    await Promise.resolve()
    expect(capturedBlobParts).toBeNull()

    releaseRender.current?.()
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())

    // The edit, not doc.source -- and the one render the blur started,
    // not a second one.
    expect((capturedBlobParts as unknown[])[0]).toBe(edited)
    expect((capturedBlobParts as unknown[])[0]).not.toBe(doc.source)
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
  })
})
