import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ruling R-15 (task-16-brief.md): pdfjs.getDocument({ data }) transfers and
 * detaches the ArrayBuffer it's given. If the exact same array used for the
 * download were also handed to pdf.js, the download would silently save a
 * detached, zero-length file -- a naive "bytes exist" assertion would not
 * catch this, since the variable still exists, just empty. This test
 * asserts the actual property that matters: pdf.js only ever receives a
 * copy, distinct from the reference the caller (and Toolbar's download)
 * still holds.
 */

const getDocumentMock = vi.fn()

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

describe('usePdfDocument', () => {
  beforeEach(() => {
    getDocumentMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('hands pdf.js a copy of the bytes, never the caller\'s own array reference', async () => {
    const { usePdfDocument } = await import('../src/features/editor/canvas/usePdfDocument')
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fakeDoc = {}
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(fakeDoc), destroy: vi.fn() })

    const { result } = renderHook(() => usePdfDocument(bytes))

    await waitFor(() => expect(result.current).toBe(fakeDoc))

    expect(getDocumentMock).toHaveBeenCalledTimes(1)
    const [{ data }] = getDocumentMock.mock.calls[0] as [{ data: Uint8Array }]

    expect(Array.from(data)).toEqual(Array.from(bytes))
    expect(data).not.toBe(bytes)
  })
})
