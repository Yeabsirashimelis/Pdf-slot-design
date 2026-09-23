'use client'

import { useRef, useState, type PointerEvent } from 'react'
import { toPdfPoint, type Viewport } from '@pdf-slot/core'
import type { DrawnRow } from './useTables'

/** Below this the drag was a click, not a row worth drawing. */
const MIN_DRAWN_PX = 6

/**
 * Drawing the first row of a table: a sheet over the page that turns one
 * drag into a rectangle. It is only mounted while the table tool is
 * armed, so nothing else on the canvas changes behaviour -- and the
 * rectangle it reports is the first row, from which the rest of the table
 * is worked out.
 */
export function TableDrawLayer({
  page,
  viewport,
  onDraw,
  onCancel,
}: {
  page: number
  /** The stage's frame (zoom 1): stage px are PDF points. */
  viewport: Viewport
  onDraw(row: DrawnRow): void
  onCancel(): void
}) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const start = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  /** Pointer position in stage px, from the layer's own box. */
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const scale = box.width === 0 ? 1 : box.width / event.currentTarget.offsetWidth
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale }
  }

  return (
    <div
      data-testid="table-draw-layer"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', pointerEvents: 'auto', touchAction: 'none' }}
      onPointerDown={(event) => {
        const point = at(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { pointerId: event.pointerId, ...point }
        setRect({ ...point, width: 0, height: 0 })
      }}
      onPointerMove={(event) => {
        const from = start.current
        if (!from || from.pointerId !== event.pointerId) return
        const point = at(event)
        setRect({
          x: Math.min(from.x, point.x),
          y: Math.min(from.y, point.y),
          width: Math.abs(point.x - from.x),
          height: Math.abs(point.y - from.y),
        })
      }}
      onPointerUp={(event) => {
        const from = start.current
        start.current = null
        const drawn = rect
        setRect(null)
        if (!from || from.pointerId !== event.pointerId) return
        if (!drawn || drawn.width < MIN_DRAWN_PX || drawn.height < MIN_DRAWN_PX) {
          onCancel()
          return
        }
        // The rectangle's top-left in PDF points: its top edge is the top
        // of the first row, and its height is how tall a row is.
        const corner = toPdfPoint({ x: drawn.x, y: drawn.y }, viewport)
        onDraw({ page, x: corner.x, y: corner.y, width: drawn.width, height: drawn.height })
      }}
      onPointerCancel={() => {
        start.current = null
        setRect(null)
        onCancel()
      }}
    >
      {rect && (
        <div
          data-testid="table-draw-rect"
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            background: 'var(--slot-highlight)',
            outline: '1px dashed var(--slot-selection)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
