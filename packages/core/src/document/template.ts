import type { PageSize, Slot } from './types'
import { tableCells, tableIdOfCell, type TemplateTable } from './table'

/** Hex SHA-256 of the uploaded PDF's bytes: how a file is recognised on re-upload. */
export type FileId = string

/**
 * A slot as saved with a file's layout (step 1): everything about a `Slot`
 * except its text, plus the name shown in the side panel and its position
 * there. The editor itself never sees names -- it works on `Slot[]`, and
 * the conversions below run at the persistence boundary.
 */
export type TemplateSlot = Omit<Slot, 'text'> & { name: string; order: number }

/**
 * A file's layout: the slots placed on it by hand, plus any table row
 * slots (see table.ts), whose cells are worked out from the table rather
 * than listed one by one. `slots` never contains a table's cells.
 */
export type TemplateLayout = {
  fileId: FileId
  slots: TemplateSlot[]
  /** Absent on layouts saved before tables existed. */
  tables?: TemplateTable[]
  updatedAt: string
}

/** What was written into the slots (step 2), keyed by slot id. Empty text is not stored. */
export type TemplateValues = { fileId: FileId; values: Record<string, string>; updatedAt: string }

export type StoredFile = {
  fileId: FileId
  name: string
  source: Uint8Array
  pages: PageSize[]
  createdAt: string
}

/**
 * The editor's slot list: the hand-placed ones, then every table's cells,
 * each carrying whatever was last written into it. A cell is an ordinary
 * slot from here on -- the editor moves and the renderer draws all of
 * them the same way.
 */
export function toSlots(layout: TemplateLayout, values?: TemplateValues | null): Slot[] {
  const placed = [...layout.slots]
    .sort((a, b) => a.order - b.order)
    .map(({ name: _name, order: _order, ...slot }) => slot)
  const cells = (layout.tables ?? []).flatMap((table) => tableCells(table))
  return [...placed, ...cells].map((slot) => ({ ...slot, text: values?.values[slot.id] ?? '' }))
}

/**
 * The layout to save. A table's cells are dropped on the way out: they
 * are derived from the table and writing them down as well would leave
 * two copies of the same geometry to drift apart.
 */
export function toLayout(
  fileId: FileId,
  slots: Slot[],
  names: Record<string, string>,
  updatedAt: string,
  tables: TemplateTable[] = [],
): TemplateLayout {
  const placed = slots.filter((slot) => tableIdOfCell(slot.id) === null)
  return {
    fileId,
    updatedAt,
    ...(tables.length > 0 ? { tables } : {}),
    slots: placed.map(({ text: _text, ...slot }, index) => ({
      ...slot,
      name: names[slot.id] ?? `Slot ${index + 1}`,
      order: index,
    })),
  }
}

export function toValues(fileId: FileId, slots: Slot[], updatedAt: string): TemplateValues {
  const values: Record<string, string> = {}
  for (const slot of slots) if (slot.text !== '') values[slot.id] = slot.text
  return { fileId, values, updatedAt }
}
