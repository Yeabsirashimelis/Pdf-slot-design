import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from '../src/features/editor/toolbar/Toolbar'

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
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saves exactly the array it was given -- the same reference, not a copy or a re-derivation', () => {
    const bytes = new Uint8Array([5, 6, 7])
    const { getByTestId } = render(createElement(Toolbar, { bytes, isRendering: false }))

    fireEvent.click(getByTestId('download-button'))

    expect(capturedBlobParts).not.toBeNull()
    expect((capturedBlobParts as unknown[])[0]).toBe(bytes)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('does nothing when there are no committed bytes yet', () => {
    const { getByTestId } = render(createElement(Toolbar, { bytes: null, isRendering: false }))

    fireEvent.click(getByTestId('download-button'))

    expect(capturedBlobParts).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
  })
})
