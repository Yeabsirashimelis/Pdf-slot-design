import { tableCells, tableIdOfCell, type Slot, type TemplateTable } from '@pdf-slot/core'

/**
 * A table's cells as slots the rest of the editor can treat like any
 * other -- the canvas draws them, the renderer exports them.
 *
 * The geometry is worked out from the table every time (widen a column
 * and forty boxes move), so the only thing kept per cell is what was
 * typed into it, looked up by the cell's derived id. That is also why
 * cells are NOT in the editor's undo history: their positions are not
 * facts to remember, they are consequences of the table.
 */
export function cellsWithText(tables: TemplateTable[], texts: Record<string, string>): Slot[] {
  return tables.flatMap((table) =>
    tableCells(table).map((cell) => ({ ...cell, text: texts[cell.id] ?? '' })),
  )
}

/** Whether this slot belongs to a table (and so is laid out by one). */
export function isCell(slotId: string): boolean {
  return tableIdOfCell(slotId) !== null
}

/** What is written in the cells of `slots`, by id -- how a saved file's text is picked back up. */
export function textsOfCells(slots: Slot[]): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const slot of slots) if (isCell(slot.id) && slot.text !== '') texts[slot.id] = slot.text
  return texts
}
