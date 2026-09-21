'use client'

import { useEffect, useRef, type MouseEvent } from 'react'
import type { RenderTask } from 'pdfjs-dist'
import { usePdfDocument } from './usePdfDocument'
import { useDevicePixelRatio } from './useDevicePixelRatio'
import { useSettledValue } from './useSettledValue'
import { toStagePoint, type StagePoint } from './coordinates'

/** How long a zoom must hold still before the page is repainted at it. */
const SETTLE_MS = 150

/**
 * The page's pixels. Fills its parent (the stage, laid out at 1 px per
 * PDF point) and is shown through the zoom/pan canvas's CSS transform, so
 * its CSS box never changes with the zoom -- only its backing store does:
 * painted at `screenScale * dpr` so that, once the transform has scaled
 * it up, one backing pixel lands on one device pixel and the page is
 * sharp at any zoom. A zoom in progress shows the previous paint,
 * stretched, until the scale settles (see useSettledValue).
 */
export function PageCanvas({
  bytes,
  pageIndex,
  screenScale,
  onCanvasClick,
  onRendered,
}: {
  bytes: Uint8Array
  pageIndex: number
  /** The CSS scale the stage is currently shown at. */
  screenScale: number
  /** A click on the page, as stage coordinates (see coordinates.ts). */
  onCanvasClick(stage: StagePoint): void
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
  // Reactive, not read once inside the effect: browser zoom changes the
  // ratio, and a backing store painted for the old one is stretched to
  // fit -- the page went blurry after Ctrl +/- until the next commit.
  const dpr = useDevicePixelRatio()
  const settledScale = useSettledValue(screenScale, SETTLE_MS)

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
      // size -- 100% of the stage, i.e. the page in points -- that the
      // overlay positions slots against. Painting at `screenScale * dpr`
      // is what keeps the page sharp on a retina display at any zoom
      // while the overlay still speaks stage px; `devicePixelRatio`
      // never leaves this file.
      const viewport = page.getViewport({ scale: settledScale * dpr })

      // Painted offscreen, then copied across in one step. Setting
      // `canvas.width` wipes a canvas, and pdf.js only starts drawing once
      // the worker has produced the page's operator list -- so painting
      // straight into the on-screen canvas blanked the whole page for a
      // few frames on every commit (each one hands this component fresh
      // bytes), a visible blink each time an edit landed. The visible
      // canvas now keeps showing the previous page until the new one is
      // complete, and the resize + drawImage below run in the same task,
      // so there is never a frame with nothing on it.
      const offscreen = document.createElement('canvas')
      offscreen.width = viewport.width
      offscreen.height = viewport.height
      renderTask = page.render({ canvas: offscreen, viewport })
      await renderTask.promise
      if (cancelled) return

      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.getContext('2d')?.drawImage(offscreen, 0, 0)
      onRendered?.(bytes)
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
  }, [pdf, pageIndex, settledScale, dpr, bytes, onRendered])

  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    // The rect is the transformed (on-screen) box; the live scale, not the
    // settled one, is what maps it back to the stage.
    const rect = canvas.getBoundingClientRect()
    onCanvasClick(toStagePoint(rect, { x: event.clientX, y: event.clientY }, screenScale))
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
}
