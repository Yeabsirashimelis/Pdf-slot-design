import { createElement } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every commit hands PageCanvas new bytes, and pdf.js repaints the page.
 * Painting straight into the on-screen canvas meant first *wiping* it
 * (setting `canvas.width` clears a canvas) and then filling it back in a
 * few frames later, once the worker had produced the page's operator list
 * -- so on every commit the whole page blinked out and back. Rendering
 * into an offscreen canvas and copying the finished page across in one
 * synchronous `drawImage` leaves nothing for the user to see in between.
 */

const getDocumentMock = vi.fn()
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}))

type Deferred = { promise: Promise<void>; resolve(): void }
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('PageCanvas painting', () => {
  const renderCalls: { canvas: HTMLCanvasElement; done: Deferred }[] = []
  const drawImage = vi.fn()

  beforeEach(() => {
    renderCalls.length = 0
    drawImage.mockReset()
    getDocumentMock.mockReset()
    getDocumentMock.mockImplementation(() => ({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
            const done = deferred()
            renderCalls.push({ canvas, done })
            return { promise: done.promise, cancel: vi.fn() }
          },
        })),
      }),
      destroy: vi.fn(),
    }))
    // jsdom has no 2d backend; a minimal context is enough to observe the
    // copy from the offscreen canvas to the visible one.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('paints offscreen and copies the finished page across in one step', async () => {
    const { PageCanvas } = await import('../src/features/editor/canvas/PageCanvas')
    const onRendered = vi.fn()
    const bytes = new Uint8Array([1, 2, 3])

    const { container } = render(
      createElement(PageCanvas, { bytes, pageIndex: 0, screenScale: 1, onCanvasClick: vi.fn(), onRendered }),
    )
    const visible = container.querySelector('canvas') as HTMLCanvasElement

    await waitFor(() => expect(renderCalls).toHaveLength(1))
    const [first] = renderCalls
    // pdf.js was never handed the on-screen canvas...
    expect(first!.canvas).not.toBe(visible)
    // ...and nothing has touched the on-screen canvas while it paints.
    expect(drawImage).not.toHaveBeenCalled()
    expect(onRendered).not.toHaveBeenCalled()

    await act(async () => {
      first!.done.resolve()
      await first!.done.promise
    })

    await waitFor(() => expect(onRendered).toHaveBeenCalledWith(bytes))
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(drawImage.mock.calls[0]![0]).toBe(first!.canvas)
    expect(visible.width).toBe(100)
    expect(visible.height).toBe(100)
  })

  it('paints the backing store at screenScale x dpr, but only once the scale has held still', async () => {
    vi.useFakeTimers()
    try {
      const { PageCanvas } = await import('../src/features/editor/canvas/PageCanvas')
      const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }))
      getDocumentMock.mockImplementation(() => ({
        promise: Promise.resolve({
          getPage: vi.fn(async () => ({
            getViewport,
            render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          })),
        }),
        destroy: vi.fn(),
      }))
      const bytes = new Uint8Array([1])
      const props = { bytes, pageIndex: 0, onCanvasClick: vi.fn() }

      const { rerender } = render(createElement(PageCanvas, { ...props, screenScale: 1 }))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(getViewport).toHaveBeenCalledWith({ scale: 1 })

      // Three quick pinch steps: no repaint until the last one settles.
      getViewport.mockClear()
      rerender(createElement(PageCanvas, { ...props, screenScale: 1.5 }))
      rerender(createElement(PageCanvas, { ...props, screenScale: 2 }))
      rerender(createElement(PageCanvas, { ...props, screenScale: 2.5 }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(getViewport).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(getViewport).toHaveBeenCalledTimes(1)
      expect(getViewport).toHaveBeenCalledWith({ scale: 2.5 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a click in stage px: screen distance from the page corner over the screen scale', async () => {
    const { PageCanvas } = await import('../src/features/editor/canvas/PageCanvas')
    const onCanvasClick = vi.fn()
    const { container } = render(
      createElement(PageCanvas, { bytes: new Uint8Array([1]), pageIndex: 0, screenScale: 2, onCanvasClick }),
    )
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 } as DOMRect)

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 60, bubbles: true }))

    expect(onCanvasClick).toHaveBeenCalledWith({ x: 50, y: 20 })
  })
})
