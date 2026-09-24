// Hand-rolled rather than shadcn: like SlotOverlay, this is a canvas
// primitive -- pointer-captured drags mapped into PDF coordinate space --
// and shadcn has no equivalent. See CLAUDE.md.
'use client'

import { useRef, type CSSProperties, type PointerEvent } from 'react'
import {
  columnLeft,
  tableHeight,
  tableWidth,
  toScreenLength,
  toScreenPoint,
  type TableColumn,
  type TemplateTable,
  type Viewport,
} from '@pdf-slot/core'
import { useTableGestures } from './useTableGestures'

/** What a drag on the table is adjusting. */
export type TableHandle =
  /** A boundary between two columns: sets the width of the column to its left. */
  | { kind: 'column'; key: string }
  /** A row's bottom edge: that row's height, the rows below moving down. */
  | { kind: 'row'; index: number }
  /** The right edge: the whole table's width, columns keeping their shares. */
  | { kind: 'width' }
  /** The corner: both at once. */
  | { kind: 'size' }
  /** The whole table. */
  | { kind: 'move' }

/** Grab strips, in screen px, so they are the same size to the hand at any zoom. */
const STRIP_PX = 8
/** How long an edge's grab bar is, and how thick the visible part is. */
const GRIP_LEN_PX = 26
const GRIP_THICK_PX = 5
/** The label that says what a handle does, in screen px. */
const LABEL_FONT_PX = 11

export type TableDragPatch = Partial<Pick<TemplateTable, 'x' | 'y'>> & {
  columnWidth?: { key: string; width: number }
  /** Every column at once: the whole table was resized. */
  columns?: TableColumn[]
  /** A row's height, or every row's: the same field either way. */
  rowHeights?: number[]
}

/** Past this, the pointer was dragged rather than clicked. */
export const DRAG_SLOP_PX = 3

/**
 * A handle: a generous area to grab, something to see once the table is
 * selected, and a word for what it does when the pointer is on it. A bar
 * five pixels wide cannot explain itself by looking like anything, and
 * these adjust different things from one another.
 *
 * A handle has to be wide enough to hit, which means it lies over the
 * cells around it -- a row's handle runs the width of the table, right
 * across the boxes people are trying to type into. So a press that never
 * moved is not a drag at all: the handle steps out of the way and hands
 * the click to whatever was underneath it, which is how clicking near
 * the bottom of a cell still puts the caret in that cell.
 */
function Handle({
  testId,
  bind,
  label,
  cursor,
  locked,
  px,
  area,
  visible,
  labelAt,
}: {
  testId: string
  /** The gesture handlers for this handle, already bound to it. */
  bind: React.DOMAttributes<HTMLElement>
  label: string
  cursor: string
  locked: boolean
  /** Screen px to stage px, so a handle is the same size to the hand at any zoom. */
  px(screen: number): number
  area: CSSProperties
  /** The bit you can see, drawn inside the grab area. */
  visible: CSSProperties
  labelAt: CSSProperties
}) {
  const self = useRef<HTMLDivElement>(null)
  const pressedAt = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pressedAt.current = { x: event.clientX, y: event.clientY }
    bind.onPointerDown?.(event)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    bind.onPointerUp?.(event)
    const from = pressedAt.current
    pressedAt.current = null
    const el = self.current
    if (!from || !el) return
    const moved = Math.abs(event.clientX - from.x) > DRAG_SLOP_PX || Math.abs(event.clientY - from.y) > DRAG_SLOP_PX
    if (moved) return

    // Nothing was dragged, so this was a click on whatever the handle is
    // covering. Look straight through it and give the click away.
    const taking = el.style.pointerEvents
    el.style.pointerEvents = 'none'
    const under = document.elementFromPoint(event.clientX, event.clientY)
    el.style.pointerEvents = taking
    const field = under instanceof HTMLElement
      ? (under instanceof HTMLTextAreaElement ? under : under.querySelector('textarea'))
      : null
    if (field instanceof HTMLTextAreaElement) field.focus()
  }

  return (
    <div
      ref={self}
      data-testid={testId}
      {...bind}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="group/handle"
      style={{
        position: 'absolute',
        pointerEvents: locked ? 'none' : 'auto',
        touchAction: 'none',
        cursor: locked ? 'default' : cursor,
        ...area,
      }}
    >
      <div
        style={{
          position: 'absolute',
          background: 'var(--slot-selection)',
          // A ring rather than a border: a border eats into a grip only
          // five pixels wide until the colour is gone. White reads
          // against both the selection tint and the dark canvas, and
          // disappears politely on the page itself.
          boxShadow: `0 0 0 ${px(1)}px rgba(255, 255, 255, 0.85)`,
          borderRadius: px(2),
          ...visible,
        }}
      />
      <span
        className="pointer-events-none opacity-0 transition-opacity group-hover/handle:opacity-100"
        style={{
          position: 'absolute',
          fontSize: px(LABEL_FONT_PX),
          lineHeight: `${px(LABEL_FONT_PX + 4)}px`,
          padding: `0 ${px(4)}px`,
          fontFamily: 'var(--font-sans)',
          color: 'var(--card)',
          background: 'var(--slot-selection)',
          borderRadius: px(3),
          whiteSpace: 'nowrap',
          userSelect: 'none',
          ...labelAt,
        }}
      >
        {label}
      </span>
    </div>
  )
}

/**
 * The chrome around a table: an outline, a divider between each pair of
 * columns, a handle on every row's bottom edge, and -- once the table is
 * selected -- a right edge and a corner that size the whole thing.
 *
 * Every handle says what it does when the pointer is on it, because a
 * bar four pixels wide cannot say it by looking like anything. Dragging
 * one reports the new measurement in PDF points; the parent applies it
 * and the cells are laid out again (see syncTableCells).
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
  // How far each row's bottom edge sits from the top of the table.
  const rowBottoms = table.rowHeights.map((_, row) =>
    table.rowHeights.slice(0, row + 1).reduce((total, each) => total + each, 0),
  )

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
      {/* The boundaries between columns: drag one and the column on its
          left takes the space from the column on its right, so the
          table's own width never moves and no other boundary shifts.
          The last column has nothing to its right to trade with, so it
          has no divider -- that edge sizes the whole table instead. */}
      {table.columns.slice(0, -1).map((column, index) => {
        const right = toScreenLength(columnLeft(table, index) + column.width - table.x, viewport)
        return (
          <Handle
            key={column.key}
            testId={`table-column-${column.key}`}
            bind={handlers({ kind: 'column', key: column.key })}
            locked={locked}
            px={px}
            label={`${column.name} width — takes from the next column`}
            cursor="ew-resize"
            area={{ left: right - px(STRIP_PX) / 2, top: 0, bottom: 0, width: px(STRIP_PX) }}
            visible={
              selected
                ? { left: (px(STRIP_PX) - px(GRIP_THICK_PX)) / 2, top: '50%', marginTop: -px(GRIP_LEN_PX) / 2, width: px(GRIP_THICK_PX), height: px(GRIP_LEN_PX) }
                : { display: 'none' }
            }
            labelAt={{ left: px(STRIP_PX + 4), top: '50%', marginTop: -px(LABEL_FONT_PX) }}
          />
        )
      })}

      {/* Every row's bottom edge, the way a spreadsheet resizes a row:
          point at the line under a row and drag it. That row grows or
          shrinks and the rows below move down; the table's own height
          follows. The last row's line is the table's bottom edge, so
          every row can be set from the line beneath it. */}
      {rowBottoms.map((bottom, row) => (
        <Handle
          key={row}
          testId={`table-row-${table.id}-${row}-edge`}
          bind={handlers({ kind: 'row', index: row })}
          locked={locked}
          px={px}
          label={`Row ${row + 1} height`}
          cursor="ns-resize"
          area={{ left: 0, right: 0, top: toScreenLength(bottom, viewport) - px(STRIP_PX) / 2, height: px(STRIP_PX) }}
          visible={
            selected
              ? {
                  left: '50%',
                  marginLeft: -px(GRIP_LEN_PX) / 2,
                  top: (px(STRIP_PX) - px(GRIP_THICK_PX)) / 2,
                  width: px(GRIP_LEN_PX),
                  height: px(GRIP_THICK_PX),
                }
              : { display: 'none' }
          }
          labelAt={{ left: '50%', marginLeft: px(GRIP_LEN_PX), top: -px(2) }}
        />
      ))}

      {/* The whole table at once, on the edges you would reach for: the
          right edge for its width, the bottom for its height, the corner
          for both. Only once it is selected -- unasked-for handles on
          every table would cover the page. */}
      {selected && !locked && (
        <>
          <Handle
            testId="table-width"
            bind={handlers({ kind: 'width' })}
        locked={locked}
        px={px}
            label="Width — all columns together"
            cursor="ew-resize"
            area={{ left: width - px(STRIP_PX) / 2, top: '50%', marginTop: -px(GRIP_LEN_PX) / 2, width: px(STRIP_PX), height: px(GRIP_LEN_PX) }}
            visible={{ inset: 0, left: (px(STRIP_PX) - px(GRIP_THICK_PX)) / 2, width: px(GRIP_THICK_PX) }}
            labelAt={{ left: px(STRIP_PX + 4), top: '50%', marginTop: -px(LABEL_FONT_PX) }}
          />
          <Handle
            testId="table-size"
            bind={handlers({ kind: 'size' })}
        locked={locked}
        px={px}
            label="Size the whole table"
            cursor="nwse-resize"
            area={{ left: width - px(STRIP_PX) / 2, top: height - px(STRIP_PX) / 2, width: px(STRIP_PX), height: px(STRIP_PX) }}
            visible={{ inset: px(1) }}
            labelAt={{ left: px(STRIP_PX + 4), top: -px(2) }}
          />
        </>
      )}

      {/* The whole table moves by its tag, as a slot moves by its name.
          Sized rather than scaled, so the words stay sharp (see
          SlotOverlay: a transform rasterises then stretches them). */}
      <span
        data-testid={`table-handle-${table.id}`}
        {...handlers({ kind: 'move' })}
        style={{
          position: 'absolute',
          left: 0,
          bottom: '100%',
          marginBottom: px(2),
          padding: `0 ${px(4)}px`,
          fontSize: px(LABEL_FONT_PX),
          lineHeight: `${px(LABEL_FONT_PX + 4)}px`,
          fontFamily: 'var(--font-sans)',
          color: 'var(--slot-selection)',
          background: 'var(--card)',
          border: `${px(1)}px solid var(--slot-highlight-edge)`,
          borderRadius: px(3),
          whiteSpace: 'nowrap',
          userSelect: 'none',
          pointerEvents: locked ? 'none' : 'auto',
          cursor: locked ? 'default' : 'move',
          touchAction: 'none',
        }}
      >
        Table · {table.rowHeights.length} row{table.rowHeights.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}
