import type { RGB, Slot } from './types'
import type { Align } from '../layout/wrap'
import type { FontId } from '../fonts/registry'

/**
 * A table row slot: one printed table row, described once and multiplied
 * down the page.
 *
 * A form like a change order log has ten identical rows waiting to be
 * filled. Placing a box in every cell is sixty boxes to draw, name, and
 * keep in line with each other. This records the *pattern* instead -- the
 * columns across, the gap down -- and the cells are worked out from it
 * (`tableCells`), so moving a column edge moves forty boxes at once and
 * "one more row" is a number, not more drawing.
 *
 * Nothing about the export changes: a cell is an ordinary `Slot`, drawn
 * by the same renderer as any other, which is what keeps the preview and
 * the download identical for tables too.
 */
export type TableColumn = {
  /** Stable across every edit, so a cell's id (and the text in it) survives a column being widened or renamed. */
  key: string
  name: string
  /** PDF points. */
  width: number
}

/** The typography every cell in a table shares. */
export type TableStyle = {
  fontId: FontId
  size: number
  color: RGB
  align: Align
  lineHeight: number
  /**
   * Space kept clear inside every cell. Shared, because a table whose
   * columns are padded differently looks like a mistake -- and because
   * setting it once is the only bearable way to pad forty cells.
   */
  padding?: number
}

export type TemplateTable = {
  id: string
  page: number
  /** Left edge of the first column, PDF points. */
  x: number
  /** Top edge of the first row, PDF points (y grows upward). */
  y: number
  columns: TableColumn[]
  /**
   * Each row's own height, top to bottom. Rows stack directly against
   * one another -- a table has no air between its rows -- so a row's
   * height is also the distance to the row below it, and the number of
   * rows is simply how many heights there are.
   */
  rowHeights: number[]
  style: TableStyle
}

/**
 * Everything a table's shared style is, and nothing else.
 *
 * A cell is a slot, so an update meant for a cell carries slot fields --
 * where it is, how wide it is. None of that belongs to the table's
 * typography, and a table that has swallowed an `x` or a `width` lays
 * every one of its cells out on top of the first (see `tableCells`).
 */
export const TABLE_STYLE_KEYS = ['fontId', 'size', 'color', 'align', 'lineHeight', 'padding'] as const

/** Just the typography out of whatever was handed over. */
export function tableStyle(patch: Record<string, unknown>): Partial<TableStyle> {
  const style: Record<string, unknown> = {}
  for (const key of TABLE_STYLE_KEYS) if (patch[key] !== undefined) style[key] = patch[key]
  return style as Partial<TableStyle>
}

/** Below this a column is no longer something you can read or click. */
export const MIN_COLUMN_WIDTH = 8

/** Below this a row -- its box or the gap to the next -- is not a row. */
export const MIN_ROW_MEASURE = 4

/**
 * A cell's slot id: derived from the table, the row and the *column key*
 * rather than stored, so the same cell keeps its identity -- and the text
 * typed into it -- across reloads, column resizes and renames.
 */
export function cellId(tableId: string, row: number, columnKey: string): string {
  return `${tableId}#${row}:${columnKey}`
}

/** The table a cell belongs to, or null for an ordinary slot. */
export function tableIdOfCell(slotId: string): string | null {
  const hash = slotId.indexOf('#')
  return hash === -1 ? null : slotId.slice(0, hash)
}

/** What the panel calls a cell: the column, and the row as a person counts them. */
export function cellName(column: TableColumn, row: number): string {
  return `${column.name} ${row + 1}`
}

/** Distance from the table's left edge to the start of column `index`. */
export function columnLeft(table: TemplateTable, index: number): number {
  return table.columns.slice(0, index).reduce((x, column) => x + column.width, table.x)
}

export function tableWidth(table: TemplateTable): number {
  return table.columns.reduce((total, column) => total + column.width, 0)
}

/** How many rows the table has. */
export function rowCount(table: TemplateTable): number {
  return table.rowHeights.length
}

/** Top of the first row to the bottom of the last. */
export function tableHeight(table: TemplateTable): number {
  return table.rowHeights.reduce((total, height) => total + height, 0)
}

/** The top edge of a row, in PDF points: every row above it, stacked. */
export function rowTop(table: TemplateTable, row: number): number {
  return table.y - table.rowHeights.slice(0, row).reduce((total, height) => total + height, 0)
}

/**
 * Every cell of the table, as slots the editor and the renderer can treat
 * like any other -- in reading order (left to right, top to bottom), which
 * is also the order the panel and the Tab key follow.
 */
export function tableCells(table: TemplateTable): Slot[] {
  const cells: Slot[] = []
  table.rowHeights.forEach((height, row) => {
    let x = table.x
    const y = rowTop(table, row)
    for (const column of table.columns) {
      cells.push({
        // The typography first: where a cell is and how big it is comes
        // from the table, and nothing in the style may talk over it.
        ...table.style,
        id: cellId(table.id, row, column.key),
        page: table.page,
        x,
        y,
        width: column.width,
        height,
        text: '',
      })
      x += column.width
    }
  })
  return cells
}

/** The same table with one column a different width; the columns after it shift along. */
export function resizeColumn(table: TemplateTable, key: string, width: number): TemplateTable {
  return {
    ...table,
    columns: table.columns.map((column) =>
      column.key === key ? { ...column, width: Math.max(MIN_COLUMN_WIDTH, width) } : column,
    ),
  }
}

/**
 * A column boundary dragged: the column takes the space it gains from
 * the column on its right, so the table's overall width never moves.
 *
 * This is what lining a table up with a printed one needs. Widening a
 * column by pushing everything after it along drags every boundary you
 * have already placed off its ruled line, so each one has to be set
 * again, in order. Trading with the neighbour leaves every other
 * boundary exactly where it is.
 *
 * The last column has nothing to its right to trade with, so it has no
 * boundary of its own: the table's right edge sizes the whole table
 * instead (see `setTableWidth`).
 */
export function resizeColumnBoundary(table: TemplateTable, key: string, width: number): TemplateTable {
  const index = table.columns.findIndex((column) => column.key === key)
  const column = table.columns[index]
  const neighbour = table.columns[index + 1]
  if (!column || !neighbour) return table

  // The two share a fixed amount of room; neither may vanish out of it.
  const between = column.width + neighbour.width
  const taken = Math.min(Math.max(width, MIN_COLUMN_WIDTH), between - MIN_COLUMN_WIDTH)
  return {
    ...table,
    columns: table.columns.map((candidate, i) =>
      i === index ? { ...candidate, width: taken } : i === index + 1 ? { ...candidate, width: between - taken } : candidate,
    ),
  }
}

/** One more row below the last, the same height as the one above it. */
export function addTableRow(table: TemplateTable): TemplateTable {
  const last = table.rowHeights[table.rowHeights.length - 1] ?? MIN_ROW_MEASURE
  return { ...table, rowHeights: [...table.rowHeights, last] }
}

/**
 * One row made taller or shorter, the rows beneath it moving down to
 * make room -- the way a spreadsheet resizes a row. The table's own
 * height follows; nothing else about it changes.
 */
export function resizeRow(table: TemplateTable, row: number, height: number): TemplateTable {
  if (row < 0 || row >= table.rowHeights.length) return table
  return {
    ...table,
    rowHeights: table.rowHeights.map((current, i) => (i === row ? Math.max(MIN_ROW_MEASURE, height) : current)),
  }
}

/**
 * Drops one row, the way deleting a line from a log does: the table loses
 * a row from the bottom, and everything written below the deleted line
 * moves up one line to close the gap.
 *
 * The printed rows themselves never move -- each one sits on its own ruled
 * line -- so this is expressed as what happens to the *text*: the ids to
 * forget, and the ids whose text shifts into the row above. The caller
 * owns what was typed, so it applies both (see `applyRowRemoval`).
 *
 * Removing the only row is refused -- a table with no rows is not a table.
 */
export function removeTableRow(
  table: TemplateTable,
  row: number,
): { table: TemplateTable; removedIds: string[]; moves: { from: string; to: string }[] } {
  if (table.rowHeights.length <= 1 || row < 0 || row >= table.rowHeights.length) {
    return { table, removedIds: [], moves: [] }
  }
  const removedIds = table.columns.map((column) => cellId(table.id, row, column.key))
  const moves: { from: string; to: string }[] = []
  for (let r = row + 1; r < table.rowHeights.length; r++) {
    for (const column of table.columns) {
      moves.push({ from: cellId(table.id, r, column.key), to: cellId(table.id, r - 1, column.key) })
    }
  }
  const rowHeights = table.rowHeights.filter((_, i) => i !== row)
  return { table: { ...table, rowHeights }, removedIds, moves }
}

/**
 * What was typed, after a row was removed: the deleted row's text is
 * gone and everything below it has moved up one row. Applied in order,
 * so a move overwrites the row it lands on and leaves nothing behind.
 */
export function applyRowRemoval(
  values: Record<string, string>,
  removal: { removedIds: string[]; moves: { from: string; to: string }[] },
): Record<string, string> {
  const next = { ...values }
  for (const id of removal.removedIds) delete next[id]
  for (const { from, to } of removal.moves) {
    const carried = next[from]
    if (carried === undefined) delete next[to]
    else next[to] = carried
    delete next[from]
  }
  return next
}

/**
 * The same table at a new overall width, every column keeping its share.
 *
 * Columns are lined up with something printed on the page, so the whole
 * table is sized as one thing far more often than a single column is:
 * dragging its right edge should take the columns with it rather than
 * stretching the last one.
 */
export function setTableWidth(table: TemplateTable, width: number): TemplateTable {
  const current = tableWidth(table)
  const narrowest = Math.min(...table.columns.map((column) => column.width))
  if (current <= 0 || narrowest <= 0) return table
  // The limit is on the scale, not on each column: clamping columns one
  // by one would keep the wide ones and quietly change every column's
  // share of the table, which is the one thing this must not do.
  const factor = Math.max(MIN_COLUMN_WIDTH / narrowest, width / current)
  return { ...table, columns: table.columns.map((column) => ({ ...column, width: column.width * factor })) }
}

/**
 * The same table at a new overall height, every row keeping its share.
 *
 * What lines a table up with a printed one: drag the corner down to the
 * last ruled line and every row in between lands on its own.
 */
export function setTableHeight(table: TemplateTable, height: number): TemplateTable {
  const current = tableHeight(table)
  const shortest = Math.min(...table.rowHeights)
  if (current <= 0 || shortest <= 0) return table
  // As with the width: the limit is on the scale, so every row keeps the
  // same share of the table it had.
  const factor = Math.max(MIN_ROW_MEASURE / shortest, height / current)
  return { ...table, rowHeights: table.rowHeights.map((row) => row * factor) }
}

/**
 * A table as it was saved before rows had their own heights.
 *
 * Tables used to be described by one row height, a pitch from one row to
 * the next, and a count. Rows now stack directly and carry their own
 * heights, so a saved table is read back with each row taking the old
 * pitch: the rows close up, but every row's top stays where it was and
 * text sits at the top of its box, so nothing printed moves.
 */
type LegacyTable = Omit<TemplateTable, 'rowHeights'> &
  Partial<Pick<TemplateTable, 'rowHeights'>> & {
    rowHeight?: number
    rowPitch?: number
    rowCount?: number
  }

export function tableFromStored(stored: LegacyTable): TemplateTable {
  const { rowHeight, rowPitch, rowCount, ...rest } = stored
  // A style that swallowed a slot's geometry is cleaned out here, so a
  // table saved while that was possible lays itself out properly again.
  const table = { ...rest, style: { ...tableStyle(stored.style), ...stored.style } as TableStyle }
  table.style = tableStyle(table.style) as TableStyle
  if (stored.rowHeights && stored.rowHeights.length > 0) {
    return { ...table, rowHeights: stored.rowHeights }
  }
  const count = Math.max(1, Math.round(rowCount ?? 1))
  const height = Math.max(MIN_ROW_MEASURE, rowPitch ?? rowHeight ?? MIN_ROW_MEASURE)
  return { ...table, rowHeights: Array.from({ length: count }, () => height) }
}
