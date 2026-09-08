'use client'

import { useEffect, useRef, type MouseEvent } from 'react'
import type { RenderTask } from 'pdfjs-dist'
import { usePdfDocument } from './usePdfDocument'
import { toLogicalPoint, type LogicalPoint } from './coordinates'

export function PageCanvas({
  bytes,
  pageIndex,
  zoom,
  onCanvasClick,
  onRendered,
}: {
  bytes: Uint8Array
  pageIndex: number
  zoom: number
  onCanvasClick(screen: LogicalPoint): void
  /**
   * Called with the exact `bytes` this component was given, once pdf.js has
   * actually finished painting them to the canvas. Rendering the real PDF
   * (Task 16's renderPdf) and painting it are two separate async stages --
   * loading the document (usePdfDocument) and then drawing the requested
   * page -- so callers that need to know "is this specific content on
   * screen yet", not just "has a render been requested", must wait for
   * this rather than inferring it from `bytes` having changed.
   */
  onRendered?(bytes: Uint8Array): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdf = usePdfDocument(bytes)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!pdf || !canvas) return

    let cancelled = false
    let renderTask: RenderTask | null = null

    void (async () => {
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return

      // The canvas has two sizes: the backing store (`canvas.width` /
      // `height`, in device pixels) that pdf.js paints into, and the CSS
      // size (`style.width` / `height`, in logical pixels) that Task 15's
      // overlay positions slots against. Scaling the render by `dpr` and
      // then dividing the CSS size back out is what keeps the page sharp
      // when zoomed on a retina display while the overlay still speaks
      // logical pixels -- `devicePixelRatio` never leaves this file.
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: zoom * dpr })

      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / dpr}px`
      canvas.style.height = `${viewport.height / dpr}px`

      renderTask = page.render({ canvas, viewport })
      await renderTask.promise
      if (!cancelled) onRendered?.(bytes)
    })().catch((err) => {
      // Cancelling the previous render (below) rejects its promise with a
      // benign RenderingCancelledException -- only unexpected failures are
      // worth surfacing.
      if (!cancelled) console.error('Failed to render PDF page', err)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageIndex, zoom, bytes, onRendered])

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    onCanvasClick(toLogicalPoint(rect, { x: event.clientX, y: event.clientY }, zoom))
  }

  return <canvas ref={canvasRef} onClick={handleClick} />
}
