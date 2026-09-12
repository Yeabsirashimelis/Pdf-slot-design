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
const renderPdfIncrementalMock =
  vi.fn<(previous: Uint8Array, slots: Slot[], fonts: unknown) => Promise<Uint8Array>>()
const loadFontBytesMock = vi.fn<() => Promise<unknown>>()

vi.mock('@pdf-slot/core', () => ({
  renderPdf: (...args: Parameters<typeof renderPdfMock>) => renderPdfMock(...args),
  renderPdfIncremental: (...args: Parameters<typeof renderPdfIncrementalMock>) =>
    renderPdfIncrementalMock(...args),
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
    renderPdfIncrementalMock.mockReset()
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

    const { result } = renderHook(() => useCommitRender(doc, slots, { renderOnCommit: true }))

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
    const { result, rerender } = renderHook(
      ({ s }: { s: Slot[] }) => useCommitRender(doc, s, { renderOnCommit: true }),
      { initialProps: { s: slots } },
    )

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

    const { result, rerender } = renderHook(
      ({ d }: { d: EditorDocument }) => useCommitRender(d, slots, { renderOnCommit: true }),
      { initialProps: { d: docA } },
    )

    act(() => {
      result.current.commit()
    })
    await waitFor(() => expect(result.current.bytes).not.toBeNull())

    rerender({ d: docB })

    expect(result.current.bytes).toBeNull()

    // And the next render for the new document starts from ITS source, not
    // as an increment on top of the old document's output.
    renderPdfMock.mockResolvedValue(new Uint8Array([8]))
    await act(async () => {
      await result.current.render()
    })
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
    expect(renderPdfMock).toHaveBeenLastCalledWith(docB, slots, FONTS)
  })

  it('commit() is a no-op unless render-on-commit is enabled -- editing costs nothing by default', async () => {
    // Per the 2026-09-12 direction: the overlay is the preview, the PDF is
    // generated once when the user asks for it. Rendering on every commit
    // stays available as a verification mode (it is how the overlay was
    // proven equal to the output), off by default.
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const { result } = renderHook(() => useCommitRender(makeDoc('doc-1'), [makeSlot('s1')]))

    act(() => {
      result.current.commit()
    })

    expect(result.current.isRendering).toBe(false)
    expect(renderPdfMock).not.toHaveBeenCalled()
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
  })

  it('render(): from scratch the first time, then an increment on top of the last output', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const first = new Uint8Array([1, 1, 1])
    const second = new Uint8Array([1, 1, 1, 2, 2])
    renderPdfMock.mockResolvedValue(first)
    renderPdfIncrementalMock.mockResolvedValue(second)

    const slotsA = [makeSlot('s1', 'one')]
    const slotsB = [makeSlot('s1', 'two')]
    const { result, rerender } = renderHook(({ s }: { s: Slot[] }) => useCommitRender(doc, s), {
      initialProps: { s: slotsA },
    })

    let out: Uint8Array | null = null
    await act(async () => {
      out = await result.current.render()
    })
    expect(out).toBe(first)
    expect(renderPdfMock).toHaveBeenCalledWith(doc, slotsA, FONTS)
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
    expect(result.current.bytes).toBe(first)
    expect(result.current.renderedSlots).toBe(slotsA)

    rerender({ s: slotsB })
    await act(async () => {
      out = await result.current.render()
    })
    expect(renderPdfIncrementalMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock).toHaveBeenCalledWith(first, slotsB, FONTS)
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(out).toBe(second)
    expect(result.current.bytes).toBe(second)
    expect(result.current.renderedSlots).toBe(slotsB)
  })

  it('render() reuses the last output when the slots have not changed since', async () => {
    // Two downloads in a row must not append an empty increment.
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const slots = [makeSlot('s1')]
    const first = new Uint8Array([1, 1, 1])
    renderPdfMock.mockResolvedValue(first)

    const { result } = renderHook(() => useCommitRender(doc, slots))

    let out: Uint8Array | null = null
    await act(async () => {
      out = await result.current.render()
    })
    await act(async () => {
      out = await result.current.render()
    })
    expect(out).toBe(first)
    expect(renderPdfMock).toHaveBeenCalledTimes(1)
    expect(renderPdfIncrementalMock).not.toHaveBeenCalled()
  })

  it('render() while a render is in flight waits for it, then increments on top if the slots moved on', async () => {
    const { useCommitRender } = await import('../src/features/editor/pipeline/useCommitRender')
    const doc = makeDoc('doc-1')
    const first = deferred<Uint8Array>()
    const firstBytes = new Uint8Array([1])
    const secondBytes = new Uint8Array([1, 2])
    renderPdfMock.mockReturnValue(first.promise)
    renderPdfIncrementalMock.mockResolvedValue(secondBytes)

    const slotsA = [makeSlot('s1', 'one')]
    const slotsB = [makeSlot('s1', 'two')]
    const { result, rerender } = renderHook(
      ({ s }: { s: Slot[] }) => useCommitRender(doc, s, { renderOnCommit: true }),
      { initialProps: { s: slotsA } },
    )

    act(() => {
      result.current.commit()
    })
    rerender({ s: slotsB })

    let out: Uint8Array | null = null
    const pending = act(async () => {
      out = await result.current.render()
    })
    first.resolve(firstBytes)
    await pending

    expect(renderPdfIncrementalMock).toHaveBeenCalledWith(firstBytes, slotsB, FONTS)
    expect(out).toBe(secondBytes)
  })
})
