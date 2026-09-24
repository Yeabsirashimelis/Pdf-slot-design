'use client'

import { useRef, type PointerEvent } from 'react'
import {
  MIN_COLUMN_WIDTH,
  resizeRow,
  setTableHeight,
  setTableWidth,
  tableHeight,
  tableWidth,
  type TemplateTable,
  type Viewport,
} from '@pdf-slot/core'
import type { TableDragPatch, TableHandle } from './TableOverlay'

type Handlers = {
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onPointerMove(event: PointerEvent<HTMLElement>): void
  onPointerUp(event: PointerEvent<HTMLElement>): void
  onPointerCancel(event: PointerEvent<HTMLElement>): void
}

/**
 * The drags on a table's frame: a boundary between two columns, the line
 * under a row, the edges that size the whole table, or the table itself.
 *
 * Each reports a measurement in PDF points, recomputed every frame from
 * the table as it was when the gesture began -- never accumulated, the
 * same rule as `dragGeometry.ts`, so a long drag cannot drift away from
 * the pointer. A hook rather than a plain function because the gesture
 * lives in a ref, which may not be touched during render.
 */
export function useTableGestures({
  table,
  viewport,
  screenScale,
  locked,
  onSelect,
  onChange,
  onCommit,
}: {
  table: TemplateTable
  viewport: Viewport
  screenScale: number
  locked: boolean
  onSelect(): void
  onChange(patch: TableDragPatch): void
  onCommit(): void
}): (handle: TableHandle) => Handlers {
  const drag = useRef<{
    pointerId: number
    handle: TableHandle
    startScreen: { x: number; y: number }
    origin: TemplateTable
  } | null>(null)

  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    drag.current = null
    onCommit()
  }

  return (handle: TableHandle) => ({
    onPointerDown(event) {
      if (locked) return
      event.stopPropagation()
      onSelect()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = {
        pointerId: event.pointerId,
        handle,
        startScreen: { x: event.clientX, y: event.clientY },
        origin: table,
      }
    },
    onPointerMove(event) {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      event.stopPropagation()
      const scale = viewport.zoom * screenScale
      const dx = (event.clientX - current.startScreen.x) / scale
      const dy = (event.clientY - current.startScreen.y) / scale
      const from = current.origin
      switch (current.handle.kind) {
        case 'move':
          // Screen y grows downward, PDF y upward.
          onChange({ x: from.x + dx, y: from.y - dy })
          return
        case 'row': {
          const index = current.handle.index
          const was = from.rowHeights[index]
          if (was === undefined) return
          onChange({ rowHeights: resizeRow(from, index, was + dy).rowHeights })
          return
        }
        case 'width':
          onChange({ columns: setTableWidth(from, tableWidth(from) + dx).columns })
          return
        case 'size':
          onChange({
            columns: setTableWidth(from, tableWidth(from) + dx).columns,
            rowHeights: setTableHeight(from, tableHeight(from) + dy).rowHeights,
          })
          return
        case 'column': {
          const key = current.handle.key
          const column = from.columns.find((candidate) => candidate.key === key)
          if (!column) return
          onChange({ columnWidth: { key, width: Math.max(MIN_COLUMN_WIDTH, column.width + dx) } })
        }
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
  })
}
