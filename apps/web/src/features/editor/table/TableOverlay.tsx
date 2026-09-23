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
  type TableColumn,
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
  /** The right edge: the whole table's width, columns keeping their shares. */
  | { kind: 'width' }
  /** The bottom edge: the whole table's height, the rows spreading to fill it. */
  | { kind: 'height' }
  /** The corner: both at once. */
  | { kind: 'size' }
  /** The whole table. */
  | { kind: 'move' }

/** Grab strips, in screen px, so they are the same size to the hand at any zoom. */
const STRIP_PX = 8
/** The gutter the row handles live in, clear of the cells, in screen px. */
const GUTTER_PX = 20
/**
 * The two row handles get a lane each, side by side in the gutter.
 * A new table's rows sit directly under one another -- rowPitch starts
 * equal to rowHeight -- so sharing a lane would stack them on the same
 * pixel and the one underneath could never be grabbed.
 */
const LANE_PX = 8
/** How long an edge's grab bar is, and how thick the visible part is. */
const GRIP_LEN_PX = 26
const GRIP_THICK_PX = 5
/** The label that says what a handle does, in screen px. */
const LABEL_FONT_PX = 11

export type TableDragPatch = Partial<Pick<TemplateTable, 'x' | 'y' | 'rowHeight' | 'rowPitch'>> & {
  columnWidth?: { key: string; width: number }
  /** Every column at once: the whole table was resized. */
  columns?: TableColumn[]
}

/**
 * A handle: a generous area to grab, something to see once the table is
 * selected, and a word for what it does when the pointer is on it. A bar
 * five pixels wide cannot explain itself by looking like anything, and
 * these adjust different things from one another.
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
  return (
    <div
      data-testid={testId}
      {...bind}
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
 * The chrome around a table: an outline, a divider on every column
 * boundary, two handles down the left for how tall a row is and the gap
 * to the next, and -- once the table is selected -- a right edge, a
 * bottom edge and a corner that size the whole thing at once.
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
          <Handle
            key={column.key}
            testId={`table-column-${column.key}`}
            bind={handlers({ kind: 'column', key: column.key })}
            locked={locked}
            px={px}
            label={`${column.name} width`}
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

      {/* The row handles live in a gutter down the left, outside the
          table: over the cells they would be sitting on top of the very
          boxes the user is trying to click into. The height handle takes
          the inner lane, the gap handle the outer one, so the two are
          always apart even when they measure the same. */}
      <Handle
        testId="table-row-height"
        bind={handlers({ kind: 'rowHeight' })}
        locked={locked}
        px={px}
        label="Row height"
        cursor="ns-resize"
        area={{
          left: -px(LANE_PX + 2),
          width: px(LANE_PX),
          top: toScreenLength(table.rowHeight, viewport) - px(STRIP_PX) / 2,
          height: px(STRIP_PX),
        }}
        visible={{ inset: `${px(1.5)}px 0`, left: 0, right: 0, opacity: 0.85 }}
        labelAt={{ right: px(LANE_PX + 4), top: -px(2) }}
      />

      {/* The gap to the next printed line. This is how the spacing is
          set: place the first row, add a second, drag it onto its line,
          and every row after follows. */}
      {table.rowCount > 1 && (
        <Handle
          testId="table-row-pitch"
          bind={handlers({ kind: 'rowPitch' })}
        locked={locked}
        px={px}
          label="Gap to the next row"
          cursor="ns-resize"
          area={{
            left: -px(GUTTER_PX),
            width: px(LANE_PX),
            top: toScreenLength(table.rowPitch, viewport) - px(STRIP_PX) / 2,
            height: px(STRIP_PX),
          }}
          visible={{ inset: `${px(1.5)}px 0`, left: 0, right: 0 }}
          labelAt={{ right: px(LANE_PX + 4), top: -px(2) }}
        />
      )}

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
            testId="table-height"
            bind={handlers({ kind: 'height' })}
        locked={locked}
        px={px}
            label="Height — spreads the rows"
            cursor="ns-resize"
            area={{ left: '50%', marginLeft: -px(GRIP_LEN_PX) / 2, top: height - px(STRIP_PX) / 2, width: px(GRIP_LEN_PX), height: px(STRIP_PX) }}
            visible={{ inset: 0, top: (px(STRIP_PX) - px(GRIP_THICK_PX)) / 2, height: px(GRIP_THICK_PX) }}
            labelAt={{ left: px(GRIP_LEN_PX + 4), top: -px(2) }}
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
        Table · {table.rowCount} row{table.rowCount === 1 ? '' : 's'}
      </span>
    </div>
  )
}
