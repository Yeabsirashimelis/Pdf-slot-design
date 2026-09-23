// Hand-rolled rather than shadcn: like SlotOverlay, this is a canvas
// primitive -- pointer-captured drags mapped into PDF coordinate space --
// and shadcn has no equivalent. See CLAUDE.md.
'use client'

import type { CSSProperties } from 'react'
import {
  columnLeft,
  tableHeight,
  tableWidth,
  toScreenLength,
  toScreenPoint,
  type TemplateTable,
  type Viewport,
} from '@pdf-slot/core'
import { useTableGestures } from './useTableGestures'

/** What a drag on the table is adjusting. */
export type TableHandle =
  /** A boundary between two columns: sets the width of the column to its left. */
  | { kind: 'column'; key: string }
  /** The bottom edge of the first row: how tall every row's text box is. */
  | { kind: 'rowHeight' }
  /** The top edge of the second row: the gap from one printed line to the next. */
  | { kind: 'rowPitch' }
  /** The whole table. */
  | { kind: 'move' }

/** Grab strips, in screen px, so they are the same size to the hand at any zoom. */
const STRIP_PX = 8
/** The gutter the row handles live in, clear of the cells, in screen px. */
const GUTTER_PX = 14

export type TableDragPatch = Partial<Pick<TemplateTable, 'x' | 'y' | 'rowHeight' | 'rowPitch'>> & {
  columnWidth?: { key: string; width: number }
}

/**
 * The chrome around a table: an outline, a divider on every column
 * boundary, and two handles down the left -- one for how tall a row is,
 * one for the gap to the next row. Dragging any of them reports the new
 * measurement in PDF points; the parent applies it and the cells are laid
 * out again (see syncTableCells).
 *
 * The cells themselves are drawn by SlotOverlay like any other slot, so
 * nothing here paints text: this is only the frame you grab.
 */
export function TableOverlay({
  table,
  viewport,
  screenScale = 1,
  selected,
  locked = false,
  onSelect,
  onChange,
  onCommit,
}: {
  table: TemplateTable
  viewport: Viewport
  screenScale?: number
  selected: boolean
  locked?: boolean
  onSelect(): void
  /** Live during a drag; every call carries the measurement from the gesture's fixed origin. */
  onChange(patch: TableDragPatch): void
  /** The drag ended: close the undo boundary. */
  onCommit(): void
}) {
  const handlers = useTableGestures({ table, viewport, screenScale, locked, onSelect, onChange, onCommit })

  const origin = toScreenPoint({ x: table.x, y: table.y }, viewport)
  const width = toScreenLength(tableWidth(table), viewport)
  const height = toScreenLength(tableHeight(table), viewport)
  const px = (screen: number) => screen / screenScale

  const strip: CSSProperties = { position: 'absolute', pointerEvents: locked ? 'none' : 'auto', touchAction: 'none' }

  return (
    <div
      data-testid={`table-${table.id}`}
      style={{
        position: 'absolute',
        left: origin.x,
        top: origin.y,
        width,
        height,
        // The frame never swallows a click meant for a cell: only its
        // handles take the pointer.
        pointerEvents: 'none',
        outline: `${px(selected ? 2 : 1)}px ${selected ? 'solid' : 'dashed'} var(--slot-selection)`,
        outlineOffset: -px(1),
      }}
    >
      {/* Every column boundary, including the right edge: drag to set the
          width of the column on its left. */}
      {table.columns.map((column, index) => {
        const right = toScreenLength(columnLeft(table, index) + column.width - table.x, viewport)
        return (
          <div
            key={column.key}
            data-testid={`table-column-${column.key}`}
            {...handlers({ kind: 'column', key: column.key })}
            style={{ ...strip, left: right - px(STRIP_PX) / 2, top: 0, bottom: 0, width: px(STRIP_PX), cursor: 'ew-resize' }}
          />
        )
      })}

      {/* The row handles live in a gutter down the left, outside the
          table: over the cells they would be sitting on top of the very
          boxes the user is trying to click into. */}
      <div
        data-testid="table-row-height"
        {...handlers({ kind: 'rowHeight' })}
        title="Row height"
        style={{
          ...strip,
          left: -px(GUTTER_PX),
          width: px(GUTTER_PX - 2),
          top: toScreenLength(table.rowHeight, viewport) - px(STRIP_PX) / 2,
          height: px(STRIP_PX),
          background: 'var(--slot-selection)',
          borderRadius: px(2),
          opacity: 0.7,
          cursor: 'ns-resize',
        }}
      />

      {/* The gap to the next printed line. This is how the spacing is
          set: place the first row, add a second, drag it onto its line,
          and every row after follows. */}
      {table.rowCount > 1 && (
        <div
          data-testid="table-row-pitch"
          {...handlers({ kind: 'rowPitch' })}
          title="Gap to the next row"
          style={{
            ...strip,
            left: -px(GUTTER_PX),
            width: px(GUTTER_PX - 2),
            top: toScreenLength(table.rowPitch, viewport) - px(STRIP_PX) / 2,
            height: px(STRIP_PX),
            background: 'var(--slot-selection)',
            borderRadius: px(2),
            cursor: 'ns-resize',
          }}
        />
      )}

      {/* The whole table moves by its tag, as a slot moves by its name. */}
      <span
        data-testid={`table-handle-${table.id}`}
        {...handlers({ kind: 'move' })}
        style={{
          position: 'absolute',
          left: 0,
          bottom: '100%',
          transformOrigin: 'bottom left',
          transform: `scale(${px(1)})`,
          marginBottom: 2,
          padding: '0 4px',
          fontSize: 10,
          lineHeight: '14px',
          fontFamily: 'var(--font-sans)',
          color: 'var(--slot-selection)',
          background: 'var(--card)',
          border: '1px solid var(--slot-highlight-edge)',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          pointerEvents: locked ? 'none' : 'auto',
          cursor: locked ? 'default' : 'move',
          touchAction: 'none',
        }}
      >
        Table · {table.rowCount} row{table.rowCount === 1 ? '' : 's'}
      </span>
    </div>
  )
}
