// Hand-rolled rather than shadcn: a ruler is a canvas-editor drawing
// primitive (a tick scale that follows zoom and pan), and shadcn has no
// equivalent component. See CLAUDE.md.
'use client'

import { useEffect, useRef } from 'react'
import { useDevicePixelRatio } from './useDevicePixelRatio'
import { rulerTicks } from './rulerTicks'

export const RULER_THICKNESS = 20

/** A range along the ruler's axis, in PDF points from the page corner. */
export type RulerRange = { from: number; to: number }

const FONT = '9px var(--font-sans), system-ui, sans-serif'

/**
 * One ruler, drawn on a canvas: the top one reads x, the left one reads
 * y, both in points from the page's top-left corner (see rulerTicks). The
 * selected slot's extent is washed in and its two edges are labelled in
 * the accent colour, the way Figma's rulers mark a selection. Redrawn
 * whenever the view moves, which is cheap: one canvas the size of the
 * ruler, a few hundred line segments at most.
 */
export function Ruler({
  orientation,
  zoom,
  offset,
  length,
  highlight = null,
}: {
  orientation: 'horizontal' | 'vertical'
  zoom: number
  /** CSS px along the ruler where the page corner (value 0) sits. */
  offset: number
  /** CSS px: the ruler's own length (the viewport's width or height). */
  length: number
  highlight?: RulerRange | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dpr = useDevicePixelRatio()
  const from = highlight?.from ?? null
  const to = highlight?.to ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || length <= 0) return
    // jsdom has no 2D context; a ruler that cannot draw is simply blank.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const horizontal = orientation === 'horizontal'
    const width = horizontal ? length : RULER_THICKNESS
    const height = horizontal ? RULER_THICKNESS : length
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    // Theme tokens, read off the element so the ruler follows globals.css.
    const styles = getComputedStyle(canvas)
    const token = (name: string) => styles.getPropertyValue(name).trim()
    const colors = {
      bg: token('--ruler'),
      tick: token('--ruler-tick'),
      text: token('--ruler-text'),
      highlight: token('--ruler-highlight'),
      accent: token('--slot-selection'),
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, width, height)

    // The selection's extent, as a band along the axis.
    if (from !== null && to !== null) {
      const a = offset + Math.min(from, to) * zoom
      const b = offset + Math.max(from, to) * zoom
      ctx.fillStyle = colors.highlight
      if (horizontal) ctx.fillRect(a, 0, b - a, height)
      else ctx.fillRect(0, a, width, b - a)
    }

    ctx.strokeStyle = colors.tick
    ctx.lineWidth = 1
    ctx.font = FONT
    ctx.textBaseline = 'top'
    ctx.fillStyle = colors.text
    for (const tick of rulerTicks(zoom, offset, length)) {
      const major = tick.label !== null
      // Half-pixel alignment keeps a 1px line on one device pixel row.
      const at = Math.round(tick.px) + 0.5
      const size = major ? RULER_THICKNESS * 0.55 : RULER_THICKNESS * 0.25
      ctx.beginPath()
      if (horizontal) {
        ctx.moveTo(at, height)
        ctx.lineTo(at, height - size)
      } else {
        ctx.moveTo(width, at)
        ctx.lineTo(width - size, at)
      }
      ctx.stroke()
      if (tick.label !== null) drawLabel(ctx, horizontal, tick.label, at + 3, colors.text)
    }

    // The two edges of the selection, called out by value.
    if (from !== null && to !== null) {
      const edges = from === to ? [from] : [Math.min(from, to), Math.max(from, to)]
      for (const value of edges) {
        const at = Math.round(offset + value * zoom) + 0.5
        drawLabel(ctx, horizontal, String(Math.round(value)), at + 3, colors.accent, colors.highlight)
      }
    }
  }, [orientation, zoom, offset, length, from, to, dpr])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid={`ruler-${orientation}`}
      style={{ display: 'block', width: orientation === 'horizontal' ? length : RULER_THICKNESS, height: orientation === 'horizontal' ? RULER_THICKNESS : length }}
    />
  )
}

/**
 * A tick's label. On the left ruler the text runs upward along the axis
 * (rotated a quarter turn), as on Figma's. `backdrop` blanks the ticks
 * behind an accent label so a selection edge reads cleanly.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  horizontal: boolean,
  text: string,
  at: number,
  color: string,
  backdrop?: string,
): void {
  ctx.save()
  if (horizontal) {
    if (backdrop) {
      ctx.fillStyle = backdrop
      ctx.fillRect(at - 1, 1, ctx.measureText(text).width + 4, 11)
    }
    ctx.fillStyle = color
    ctx.fillText(text, at, 2)
  } else {
    ctx.translate(2, at)
    ctx.rotate(-Math.PI / 2)
    if (backdrop) {
      ctx.fillStyle = backdrop
      ctx.fillRect(-ctx.measureText(text).width - 3, -1, ctx.measureText(text).width + 4, 11)
    }
    ctx.fillStyle = color
    // Rotated a quarter turn anticlockwise, "along the axis" is now −x.
    ctx.textAlign = 'right'
    ctx.fillText(text, -1, 0)
  }
  ctx.restore()
}
