import { createElement, useMemo, useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * End-to-end (within jsdom, at the seam) check of the whole guarantee this
 * task exists to deliver: commit() is what calls renderPdf, and download()
 * saves exactly what commit() produced without ever calling renderPdf
 * again. See task-16-brief.md.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()

vi.mock('@pdf-slot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pdf-slot/core')>()
  return {
    ...actual,
    renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
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

  it('download saves exactly what the last commit rendered, without rendering again', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { Toolbar } = await import('../src/features/editor/toolbar/Toolbar')

    const output = new Uint8Array([42, 43])
    renderPdfMock.mockResolvedValue(output)

    function Harness() {
      const doc = makeDoc()
      const { bytes, isRendering, commit, flush } = useCommitRender(doc, [makeSlot()])
      return createElement(
        'div',
        null,
        createElement('button', { onClick: commit, 'data-testid': 'commit-button' }, 'Commit'),
        createElement(Toolbar, {
          doc,
          bytes,
          isRendering,
          flush,
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

    // Nothing has committed yet: renderPdf must not have been called just
    // from mounting.
    expect(renderPdfMock).not.toHaveBeenCalled()

    fireEvent.click(getByTestId('commit-button'))
    // Synchronise on the render itself having landed -- the previous
    // version of this test waited on `downloadButton.disabled` becoming
    // false, which was true on the very first check because the button was
    // never disabled at all. It passed only because waitFor's microtask
    // ticks happened to let the mocked render finish.
    await waitFor(() => expect(renderPdfMock).toHaveBeenCalledTimes(1))

    fireEvent.click(getByTestId('download-button'))
    await waitFor(() => expect(capturedBlobParts).not.toBeNull())

    expect((capturedBlobParts as unknown[])[0]).toBe(output)
    // The whole point of this task: downloading must not regenerate the
    // PDF. If it did, this would be 2.
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
  })

  it('download clicked in the same interaction as the edit saves the edit, not the source', async () => {
    // The real first-run path, and the one the old test could not see.
    // Pressing Download blurs the focused textarea; blur IS the commit
    // boundary, so mousedown starts renderPdf and the click lands a few
    // milliseconds later with `bytes` still null. Reading `bytes ??
    // doc.source` at that moment saved the UNEDITED document.
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
      const { bytes, isRendering, commit, flush } = useCommitRender(doc, slots)
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
          doc,
          bytes,
          isRendering,
          flush,
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

    // The edit, not doc.source.
    expect((capturedBlobParts as unknown[])[0]).toBe(edited)
    expect((capturedBlobParts as unknown[])[0]).not.toBe(doc.source)
  })
})
