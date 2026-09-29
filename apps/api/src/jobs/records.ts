import { tableCellValues, type TemplateLayout } from '@pdf-slot/core'
import type { JobRecord } from '@pdf-slot/contracts'

/**
 * A record is keyed by slot *name* and table *name*; the renderer wants
 * slot id -> text.
 *
 * Whatever the record and the file have in common is filled in and the
 * rest is left alone, in both directions: a name the file does not have
 * prints nowhere, and a slot or table the record does not mention prints
 * blank. So a record of plain values fills the slots and leaves the table
 * empty, a record of rows fills the table and leaves the slots empty, and
 * a record of both fills both -- without any of the three being a
 * different kind of job.
 */
export function recordToValues(layout: TemplateLayout, record: JobRecord): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of layout.slots) {
    const text = record[slot.name]
    // A list under a slot's name is rows meant for a table; it is not
    // text and there is nothing sensible to print, so it is passed over
    // here and reported by the check the panel runs before submitting.
    if (typeof text === 'string' && text !== '') values[slot.id] = text
  }
  for (const table of layout.tables ?? []) {
    const rows = record[table.name]
    if (!Array.isArray(rows)) continue
    Object.assign(values, tableCellValues(table, rows).values)
  }
  return values
}

export const itemFileName = (index: number) => `record-${String(index + 1).padStart(4, '0')}.pdf`
export const itemPath = (jobId: string, index: number) => `jobs/${jobId}/${itemFileName(index)}`
export const zipPath = (jobId: string) => `jobs/${jobId}/all.zip`
