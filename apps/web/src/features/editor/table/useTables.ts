'use client'

import { useMemo } from 'react'
import {
  MIN_COLUMN_WIDTH,
  MIN_ROW_MEASURE,
  addTableRow,
  resizeColumnBoundary,
  applyRowRemoval,
  cellId,
  removeTableRow,
  resizeColumn,
  tableIdOfCell,
  type Slot,
  type TableStyle,
  type TemplateTable,
} from '@pdf-slot/core'
import { randomId } from '@/lib/files/fileHash'
import { cellsWithText } from './tableSlots'
import type { TableDragPatch } from './TableOverlay'

/** A row drawn on the page, in PDF points: where a new table starts from. */
export type DrawnRow = { page: number; x: number; y: number; width: number; height: number }

/**
 * The tables on a file, and what is written in their cells.
 *
 * The state itself lives in the editor's history, not here, so one
 * Ctrl+Z takes back whichever thing was last done -- a slot moved, a
 * column widened, a row dropped. A cell's position is a consequence of
 * its table rather than a fact of its own, so the two have to travel
 * together: the history holds the tables and the slots in one snapshot,
 * and cannot restore one without the other.
 *
 * What is left here is the vocabulary -- draw a table, add a row, widen
 * a column -- each expressed as the next set of tables for the store.
 */
export function useTables(store: {
  tables: TemplateTable[]
  texts: Record<string, string>
  setTables(change: { tables?: TemplateTable[]; texts?: Record<string, string> }, step?: boolean): void
}) {
  const { tables, texts } = store

  const cells = useMemo(() => cellsWithText(tables, texts), [tables, texts])

  /** One whole change, closed to undo the moment it is made. */
  const update = (id: string, change: (table: TemplateTable) => TemplateTable, step = true) =>
    store.setTables({ tables: tables.map((table) => (table.id === id ? change(table) : table)) }, step)

  return {
    tables,
    /** Every table's cells, as slots, with their text. */
    cells,
    /** The table a slot belongs to, or null if it was placed by hand. */
    tableOf(slotId: string): TemplateTable | null {
      const id = tableIdOfCell(slotId)
      return id === null ? null : (tables.find((table) => table.id === id) ?? null)
    },

    /** A row drawn on the page becomes a one-column, one-row table. */
    create(row: DrawnRow, style: TableStyle): TemplateTable {
      const table: TemplateTable = {
        id: `tbl${randomId()}`,
        page: row.page,
        x: row.x,
        y: row.y,
        columns: [{ key: `col${randomId()}`, name: 'Column 1', width: Math.max(MIN_COLUMN_WIDTH, row.width) }],
        // One row, its own height; every row added after copies the one
        // above it, so a table of ten rows drawn against a ruled form is
        // ten rows of the same height.
        rowHeights: [Math.max(MIN_ROW_MEASURE, row.height)],
        style,
      }
      store.setTables({ tables: [...tables, table] }, true)
      return table
    },

    remove(id: string) {
      store.setTables({
        tables: tables.filter((table) => table.id !== id),
        texts: Object.fromEntries(Object.entries(texts).filter(([key]) => tableIdOfCell(key) !== id)),
      }, true)
    },

    /** Live from the handles on the page (see TableOverlay). */
    applyDrag(id: string, patch: TableDragPatch) {
      update(id, (table) => {
        const { columnWidth, ...rest } = patch
        const moved = { ...table, ...rest }
        // A boundary dragged on the page trades with its neighbour and
        // leaves the table's width alone; a width typed into the panel
        // still sets that column outright (see setColumnWidth).
        return columnWidth ? resizeColumnBoundary(moved, columnWidth.key, columnWidth.width) : moved
      }, false)
    },

    setColumnWidth(id: string, key: string, width: number) {
      update(id, (table) => resizeColumn(table, key, width))
    },

    renameColumn(id: string, key: string, name: string) {
      update(id, (table) => ({
        ...table,
        columns: table.columns.map((column) => (column.key === key ? { ...column, name } : column)),
      }))
    },

    /**
     * Splits the last column in two, so every column already lined up
     * with the printed table keeps its width.
     */
    addColumn(id: string) {
      update(id, (table) => {
        const last = table.columns[table.columns.length - 1]
        if (!last) return table
        const half = Math.max(MIN_COLUMN_WIDTH, last.width / 2)
        return {
          ...table,
          columns: [
            ...table.columns.slice(0, -1),
            { ...last, width: half },
            { key: `col${randomId()}`, name: `Column ${table.columns.length + 1}`, width: Math.max(MIN_COLUMN_WIDTH, last.width - half) },
          ],
        }
      })
    },

    removeColumn(id: string, key: string) {
      const table = tables.find((candidate) => candidate.id === id)
      if (!table || table.columns.length <= 1) return
      store.setTables({
        tables: tables.map((candidate) =>
          candidate.id === id
            ? { ...candidate, columns: candidate.columns.filter((column) => column.key !== key) }
            : candidate,
        ),
        texts: Object.fromEntries(
          Object.entries(texts).filter(([cell]) => !cell.startsWith(`${id}#`) || !cell.endsWith(`:${key}`)),
        ),
      }, true)
    },

    addRow(id: string) {
      update(id, addTableRow)
    },

    /** Drops a line: the table loses a row and what was below moves up. */
    removeRow(id: string, row: number) {
      const table = tables.find((candidate) => candidate.id === id)
      if (!table) return
      const removal = removeTableRow(table, row)
      if (removal.removedIds.length === 0) return
      // The row and the text that moves up with it are one step.
      store.setTables({
        tables: tables.map((candidate) => (candidate.id === id ? removal.table : candidate)),
        texts: applyRowRemoval(texts, removal),
      }, true)
    },

    /** Restyles the whole table: every cell shares one typography. */
    setStyle(id: string, patch: Partial<TableStyle>) {
      // Live: restyling comes from the panel's fields, and a held arrow
      // there is one change. The editor closes the boundary when the key
      // is let go, so the whole hold is a single undo step.
      update(id, (table) => ({ ...table, style: { ...table.style, ...patch } }), false)
    },

    setCellText(cell: string, text: string) {
      // Typing is live: a word becomes one undo step, not one per letter.
      store.setTables({ texts: { ...texts, [cell]: text } }, false)
    },

    /** The first cell of a row -- what selecting a row in the panel points at. */
    firstCellOfRow(table: TemplateTable, row: number): string | null {
      const column = table.columns[0]
      return column ? cellId(table.id, row, column.key) : null
    },

    /** Picks the cells' text back up from a freshly opened file. */
    reset(nextTables: TemplateTable[], nextTexts: Record<string, string>) {
      store.setTables({ tables: nextTables, texts: nextTexts }, true)
    },
  }
}

export type Tables = ReturnType<typeof useTables>

/** The text a table cell holds, for the rows the panel previews. */
export function cellTexts(cells: Slot[]): Record<string, string> {
  return Object.fromEntries(cells.map((cell) => [cell.id, cell.text]))
}
