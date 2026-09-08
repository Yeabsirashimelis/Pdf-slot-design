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
}: {
  bytes: Uint8Array
  pageIndex: number
  zoom: number
  onCanvasClick(screen: LogicalPoint): void
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
  }, [pdf, pageIndex, zoom])

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    onCanvasClick(toLogicalPoint(rect, { x: event.clientX, y: event.clientY }, zoom))
  }

  return <canvas ref={canvasRef} onClick={handleClick} />
}
