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
}

export type TemplateTable = {
  id: string
  page: number
  /** Left edge of the first column, PDF points. */
  x: number
  /** Top edge of the first row, PDF points (y grows upward). */
  y: number
  columns: TableColumn[]
  /** How tall one row's text box is. */
  rowHeight: number
  /** Top of one row to the top of the next -- the printed line spacing. */
  rowPitch: number
  rowCount: number
  style: TableStyle
}

/** Below this a column is no longer something you can read or click. */
export const MIN_COLUMN_WIDTH = 8

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

/** Top of the first row to the bottom of the last. */
export function tableHeight(table: TemplateTable): number {
  return (table.rowCount - 1) * table.rowPitch + table.rowHeight
}

/** The top edge of a row, in PDF points. */
export function rowTop(table: TemplateTable, row: number): number {
  return table.y - row * table.rowPitch
}

/**
 * Every cell of the table, as slots the editor and the renderer can treat
 * like any other -- in reading order (left to right, top to bottom), which
 * is also the order the panel and the Tab key follow.
 */
export function tableCells(table: TemplateTable): Slot[] {
  const cells: Slot[] = []
  for (let row = 0; row < table.rowCount; row++) {
    let x = table.x
    for (const column of table.columns) {
      cells.push({
        id: cellId(table.id, row, column.key),
        page: table.page,
        x,
        y: rowTop(table, row),
        width: column.width,
        height: table.rowHeight,
        text: '',
        ...table.style,
      })
      x += column.width
    }
  }
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

/** One more row, directly below the last one, at the same pitch. */
export function addTableRow(table: TemplateTable): TemplateTable {
  return { ...table, rowCount: table.rowCount + 1 }
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
  if (table.rowCount <= 1 || row < 0 || row >= table.rowCount) {
    return { table, removedIds: [], moves: [] }
  }
  const removedIds = table.columns.map((column) => cellId(table.id, row, column.key))
  const moves: { from: string; to: string }[] = []
  for (let r = row + 1; r < table.rowCount; r++) {
    for (const column of table.columns) {
      moves.push({ from: cellId(table.id, r, column.key), to: cellId(table.id, r - 1, column.key) })
    }
  }
  return { table: { ...table, rowCount: table.rowCount - 1 }, removedIds, moves }
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
