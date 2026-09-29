import { tableCellValues } from './table'
import type { TemplateLayout } from './template'

/**
 * One record of a data file: text under a slot's name, a list of rows
 * under a table's name.
 *
 * Declared here rather than imported from the contracts package, which
 * depends on this one: it is the same shape, and the contract's schema is
 * what checks a record really has it.
 */
export type RecordValue = string | Record<string, string>[]
export type DataRecord = Record<string, RecordValue>

/**
 * A record, turned into the text of this file's boxes -- keyed by slot id,
 * which is what the renderer and the overlay both want.
 *
 * Whatever the record and the file have in common is filled in and the
 * rest is left alone, in both directions: a name the file does not have
 * fills nothing, and a slot or table the record does not mention is left
 * out of the result rather than blanked, so a caller can decide for
 * itself whether those keep what they had.
 *
 * Shared by the generation job and the editor's preview of a record on
 * purpose: they must agree to the letter, or what is previewed is not
 * what is generated.
 */
export function recordToValues(layout: TemplateLayout, record: DataRecord): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of layout.slots) {
    const text = record[slot.name]
    // A list under a slot's name is rows meant for a table; it is not text
    // and there is nothing sensible to print, so it is passed over here
    // and reported by the check made before a job is ever submitted.
    if (typeof text === 'string' && text !== '') values[slot.id] = text
  }
  for (const table of layout.tables ?? []) {
    const rows = record[table.name]
    if (!Array.isArray(rows)) continue
    Object.assign(values, tableCellValues(table, rows).values)
  }
  return values
}
