import { createElement } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorDocument, Slot } from '@pdf-slot/core'

/**
 * These tests exist to catch exactly the failure mode the task brief warns
 * about: a pipeline that is wired up in name only. Before this test suite
 * was written, the stubbed pipeline (renderPdf() => new Uint8Array())
 * was confirmed to turn "commit() calls renderPdf and stores its result"
 * red -- see task-16-report.md for the exact failure message.
 */

const renderPdfMock = vi.fn<(doc: EditorDocument, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
const loadFontBytesMock = vi.fn<() => Promise<unknown>>()

vi.mock('@pdf-slot/core', () => ({
  renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
}))

vi.mock('../src/lib/fonts/loadFonts', () => ({
  loadFontBytes: () => loadFontBytesMock(),
}))

const FONTS = { fake: 'fonts' }

function makeDoc(id: string): EditorDocument {
  return { id, source: new Uint8Array([1, 2, 3]), pages: [{ width: 612, height: 792 }] }
}

function makeSlot(id: string, text = 'hello'): Slot {
  return {
    id,
    page: 0,
    x: 10,
    y: 10,
    width: 200,
    text,
    fontId: 'sans',
    size: 14,
    color: { r: 0, g: 0, b: 0 },
    align: 'left',
    lineHeight: 1.2,
  }
}

/** Resolves/rejects on demand, so tests can control completion order. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useCommitRender', () => {
  beforeEach(() => {
    renderPdfMock.mockReset()
    loadFontBytesMock.mockReset()
    loadFontBytesMock.mockResolvedValue(FONTS)
  })

  afterEach(() => {
    cleanup()
  })

  it('never calls renderPdf just from mounting -- only commit() triggers a render', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const slots = [makeSlot('s1')]

    const { result } = renderHook(() => useCommitRender(doc, slots))

    expect(result.current.bytes).toBeNull()
    expect(renderPdfMock).not.toHaveBeenCalled()
  })

  it('commit() calls renderPdf with the current doc/slots/fonts and stores the result as bytes', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const slots = [makeSlot('s1', 'Acme Construction Company Limited')]
    const output = new Uint8Array([9, 9, 9])
    renderPdfMock.mockResolvedValue(output)

    const { result } = renderHook(() => useCommitRender(doc, slots))

    act(() => {
      result.current.commit()
    })

    expect(result.current.isRendering).toBe(true)

    await waitFor(() => expect(result.current.bytes).not.toBeNull())

    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfMock).toHaveBeenCalledWith(doc, slots, FONTS)
    expect(result.current.bytes).toBe(output)
    expect(result.current.isRendering).toBe(false)
  })

  it('discards a slower, out-of-order render instead of letting it overwrite a newer commit', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const slow = deferred<Uint8Array>()
    const fast = deferred<Uint8Array>()
    renderPdfMock.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    let slots: Slot[] = [makeSlot('s1', 'first')]
    const { result, rerender } = renderHook(({ s }: { s: Slot[] }) => useCommitRender(doc, s), {
      initialProps: { s: slots },
    })

    // First commit starts a render that will resolve LAST.
    act(() => {
      result.current.commit()
    })

    // A second, later edit and commit starts a render that will resolve
    // FIRST -- simulating a fast user committing twice before the first
    // render finishes.
    slots = [makeSlot('s1', 'second')]
    rerender({ s: slots })
    act(() => {
      result.current.commit()
    })

    const fastBytes = new Uint8Array([2])
    const slowBytes = new Uint8Array([1])

    // The newer (second) commit's render finishes first...
    act(() => {
      fast.resolve(fastBytes)
    })
    await waitFor(() => expect(result.current.bytes).toBe(fastBytes))

    // ...then the stale, older render finishes late. It must be discarded:
    // the preview (and therefore the download) must keep reflecting the
    // newer commit, not silently revert to the older one.
    act(() => {
      slow.resolve(slowBytes)
    })
    // Give any (incorrect) state update a chance to land before asserting
    // it didn't.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.bytes).toBe(fastBytes)
    expect(result.current.isRendering).toBe(false)
    expect(renderPdfMock).toHaveBeenCalledTimes(2)
  })

  it('resets bytes when a new document is loaded', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const docA = makeDoc('doc-a')
    const docB = makeDoc('doc-b')
    const slots = [makeSlot('s1')]
    renderPdfMock.mockResolvedValue(new Uint8Array([7]))

    const { result, rerender } = renderHook(({ d }: { d: EditorDocument }) => useCommitRender(d, slots), {
      initialProps: { d: docA },
    })

    act(() => {
      result.current.commit()
    })
    await waitFor(() => expect(result.current.bytes).not.toBeNull())

    rerender({ d: docB })

    expect(result.current.bytes).toBeNull()
  })
})
