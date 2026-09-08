import { createElement } from 'react'
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
      const { bytes, isRendering, commit } = useCommitRender(doc, [makeSlot()])
      return createElement(
        'div',
        null,
        createElement('button', { onClick: commit, 'data-testid': 'commit-button' }, 'Commit'),
        createElement(Toolbar, {
          doc,
          bytes,
          isRendering,
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
    await waitFor(() =>
      expect((getByTestId('download-button') as HTMLButtonElement).disabled).toBe(false),
    )

    expect(renderPdfMock).toHaveBeenCalledTimes(1)

    fireEvent.click(getByTestId('download-button'))

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(output)
    // The whole point of this task: downloading must not regenerate the
    // PDF. If it did, this would be 2.
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
  })
})
