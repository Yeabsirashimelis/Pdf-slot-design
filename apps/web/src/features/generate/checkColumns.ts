import type { JobRecord } from '@pdf-slot/contracts'
import { parseRecords } from './parseRecords'

/** A table a record can address: its name, what its columns are called, and how many lines it has. */
export type TableTarget = { name: string; columns: string[]; rowCount: number }

/** What the file offers a record to fill: named boxes, and named tables. */
export type FillTargets = { slotNames: readonly string[]; tables: readonly TableTarget[] }

/** What the data had to say about one table. */
export type TableCheck = {
  name: string
  /** The keys of the table's first row. */
  columns: string[]
  /** Keys naming no column of that table: printed nowhere. */
  unknown: string[]
  /** Columns no key fills: printed blank. */
  missing: string[]
  suggestions: Record<string, string>
  /** Rows carried that the table has no ruled line for, at its worst across the records. */
  extraRows: number
}

export type ColumnCheck = {
  /** The keys of the first record, in order. */
  columns: string[]
  /** Columns that name neither a slot nor a table: their values are printed nowhere. */
  unknown: string[]
  /** Slots and tables no column fills: they are printed blank. */
  missing: string[]
  /** For an unknown column, the slot or table it was most likely meant to be. */
  suggestions: Record<string, string>
  /** Slots the data actually carries text for. */
  slotsFilled: string[]
  /** One per table the data actually addressed. */
  tables: TableCheck[]
  /**
   * Keys that named the right thing the wrong way round: rows handed to a
   * slot, or text handed to a table. Worth naming on its own, because the
   * name matches and the value is still going nowhere.
   */
  wrongKind: string[]
}

/** Beyond two edits apart, "did you mean" stops being help and starts being noise. */
const MAX_TYPO_DISTANCE = 2

const EMPTY: ColumnCheck = { columns: [], unknown: [], missing: [], suggestions: {}, slotsFilled: [], tables: [], wrongKind: [] }

/**
 * Holds the data up against what the file has to fill: its slots, and its tables.
 *
 * Neither list being a subset of the other is legitimate -- a spreadsheet may carry columns this
 * template does not print, and a slot may be meant to stay blank -- so nothing here is an error.
 * It exists so a mistyped column is seen before it prints 5000 blank PDFs.
 *
 * A record fills whatever it can reach and leaves the rest: text under a
 * slot's name, a list of rows under a table's name, either or both. That
 * is the whole of "one file for slots, tables, or both" -- there is no
 * second kind of job, only a record that happens to carry rows as well.
 */
export function checkColumns(records: readonly JobRecord[], targets: FillTargets): ColumnCheck {
  const first = records[0]
  // Nothing to hold anything up against: with no rows, every slot would read as "missing", which
  // tells the user nothing they did not already know.
  if (!first) return EMPTY
  const { slotNames, tables } = targets
  const columns = Object.keys(first)
  // Exact and case-sensitive: slot names are matched that way everywhere else, and the summary
  // would be lying if it showed a column as matched that the renderer will not match.
  const slots = new Set(slotNames)
  const byName = new Map(tables.map((table) => [table.name, table]))
  const covered = new Set(columns)

  const unknown: string[] = []
  const wrongKind: string[] = []
  const slotsFilled: string[] = []
  const filled: TableCheck[] = []
  for (const column of columns) {
    const rows = first[column]
    const table = byName.get(column)
    if (table) {
      if (Array.isArray(rows)) filled.push(checkTable(table, records))
      else wrongKind.push(`"${column}" is a table, so it needs a list of rows, not text`)
      continue
    }
    if (slots.has(column)) {
      if (Array.isArray(rows)) wrongKind.push(`"${column}" is a slot, so it needs text, not a list of rows`)
      else slotsFilled.push(column)
      continue
    }
    unknown.push(column)
  }

  const names = [...slotNames, ...tables.map((table) => table.name)]
  const missing = [...new Set(names)].filter((name) => !covered.has(name))
  const suggestions: Record<string, string> = {}
  for (const column of unknown) {
    const nearest = nearestName(column, names)
    if (nearest !== undefined) suggestions[column] = nearest
  }
  return { columns, unknown, missing, suggestions, slotsFilled, tables: filled, wrongKind }
}

/**
 * One table, against every record that carries rows for it: the columns
 * from the first such row, and the worst overflow anywhere in the file --
 * one record with too many rows is worth knowing about before generating,
 * not after.
 */
function checkTable(table: TableTarget, records: readonly JobRecord[]): TableCheck {
  let columns: string[] = []
  let extraRows = 0
  for (const record of records) {
    const rows = record[table.name]
    if (!Array.isArray(rows)) continue
    if (columns.length === 0 && rows[0]) columns = Object.keys(rows[0])
    extraRows = Math.max(extraRows, rows.length - table.rowCount)
  }
  const named = new Set(table.columns)
  const covered = new Set(columns)
  const unknown = columns.filter((column) => !named.has(column))
  const missing = table.columns.filter((column) => !covered.has(column))
  const suggestions: Record<string, string> = {}
  for (const column of unknown) {
    const nearest = nearestName(column, table.columns)
    if (nearest !== undefined) suggestions[column] = nearest
  }
  return { name: table.name, columns, unknown, missing, suggestions, extraRows: Math.max(0, extraRows) }
}

/**
 * True when the data fills nothing at all -- never a legitimate accident (unlike an extra column,
 * or a slot left deliberately blank), so this is the one case that must block generation outright.
 * Shared by the panel's live summary and by `submit()` itself, so the two can never fall out of
 * sync on what counts as "nothing matches".
 *
 * A table counts as filled only if at least one of its columns matched: a
 * record that names the right table and then gets every column name wrong
 * prints exactly as blank as one that names no table at all.
 */
export function noColumnsMatch(check: ColumnCheck, targets: FillTargets): boolean {
  const offered = targets.slotNames.length + targets.tables.length
  if (offered === 0 || check.columns.length === 0) return false
  const tableFilled = check.tables.some((table) => table.columns.length > table.unknown.length)
  return check.slotsFilled.length === 0 && !tableFilled
}

/** The one message shown for `noColumnsMatch`, wherever it needs to be shown. */
export function noColumnsMatchMessage(targets: FillTargets): string {
  const names = [...targets.slotNames, ...targets.tables.map((table) => table.name)]
  const what = targets.tables.length === 0 ? 'slots' : 'slots or tables'
  return `None of these columns match your ${what} (${names.join(', ')})`
}

/** What `submit()` needs to decide: the records to send, or the one reason it must not send them. */
export type SubmitValidation = { records: JobRecord[] } | { error: string }

/**
 * The guard `submit()` runs before it ever calls the API, pulled out so it can be tested directly
 * rather than through a button click. Runs `parseRecords`, then the same two checks in the same
 * order `submit()` has always run them in: a column mismatch is caught before an empty key is,
 * because a mistyped file is the more useful thing to tell the user about first.
 */
export function validateBeforeSubmit({ text, targets, apiKey }: { text: string; targets: FillTargets; apiKey: string }): SubmitValidation {
  const parsed = parseRecords(text)
  if ('error' in parsed) return { error: parsed.error }
  if (noColumnsMatch(checkColumns(parsed.records, targets), targets)) return { error: noColumnsMatchMessage(targets) }
  if (apiKey.trim() === '') return { error: 'Enter your API key' }
  return { records: parsed.records }
}

function nearestName(column: string, names: readonly string[]): string | undefined {
  // Compared without case or surrounding space, so "name" and " Name " are zero edits from
  // "Name" and are suggested outright, while "Nmae" is the two edits the threshold allows.
  const wanted = column.trim().toLowerCase()
  let best: string | undefined
  let shortest = MAX_TYPO_DISTANCE + 1
  for (const name of names) {
    const distance = editDistance(wanted, name.trim().toLowerCase())
    if (distance < shortest) { shortest = distance; best = name }
  }
  return shortest <= MAX_TYPO_DISTANCE ? best : undefined
}

/**
 * Levenshtein distance, kept to two rows of the matrix.
 *
 * The one algorithm this project writes instead of installing: every package for it is these
 * dozen lines, and a dependency whose entire surface is `distance(a, b)` costs more to carry
 * and audit than to own.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution)
    }
    previous = current
  }
  return previous[b.length]!
}
