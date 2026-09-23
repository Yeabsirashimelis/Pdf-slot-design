import Papa, { type ParseError } from 'papaparse'
import { MAX_JOB_RECORDS } from '@pdf-slot/contracts'

export type ParsedRecords = { records: Record<string, string>[] } | { error: string }

/** A pasted JSON array of objects, or CSV whose header row names the slots. */
export function parseRecords(text: string): ParsedRecords {
  // Excel and Windows editors prefix a UTF-8 CSV with a byte-order mark. Stripped explicitly, not
  // left to `trim()` (which happens to treat U+FEFF as whitespace): left in, the first header cell
  // would be "\uFEFFName" and never match a slot named "Name".
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (trimmed === '') return { error: 'Paste a JSON array or CSV' }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJson(trimmed)
  // Neither a comma nor a line break: not recognisable as tabular data at
  // all (as opposed to a header-only CSV, which has at least a line break).
  if (!/[,\r\n]/.test(text)) return { error: 'Paste a JSON array or CSV' }
  return parseCsv(trimmed)
}

/** The server refuses a job past this size; refused here too, where the user can still fix the data. */
function withinLimit(records: Record<string, string>[]): ParsedRecords {
  if (records.length > MAX_JOB_RECORDS) {
    return { error: `${records.length} rows is more than the limit of ${MAX_JOB_RECORDS}` }
  }
  return { records }
}

function parseJson(text: string): ParsedRecords {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { error: 'Not valid JSON' } }
  if (!Array.isArray(data)) return { error: 'Expected a JSON array of objects' }
  const records: Record<string, string>[] = []
  for (const [i, row] of data.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return { error: `Row ${i + 1} is not an object` }
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string') return { error: `Every value must be text (row ${i + 1}, "${key}")` }
    }
    records.push(row as Record<string, string>)
  }
  if (records.length === 0) return { error: 'The array is empty' }
  return { records }
}

const FIELD_COUNT_TROUBLE: Partial<Record<ParseError['code'], string>> = {
  TooFewFields: 'too few fields',
  TooManyFields: 'too many fields',
}

/** CSV is papaparse's job (RFC 4180, quotes, CRLF, BOM); ours is turning its complaints into advice. */
function parseCsv(text: string): ParsedRecords {
  const { data, errors, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const fields = meta.fields ?? []
  const duplicate = duplicateHeader(fields, meta.renamedHeaders)
  if (duplicate !== undefined) return { error: `Two columns are named "${duplicate}"` }
  const unnamed = fields.indexOf('')
  if (unnamed !== -1) return { error: `Column ${unnamed + 1} has no name` }
  // A one-column CSV has no delimiter to detect, so papaparse says so and falls back to a comma --
  // which is what we want. Reporting that as a problem with the data would be a lie.
  const rowTrouble = errors.filter((e) => e.type !== 'Delimiter')
  if (rowTrouble.length > 0) return { error: describeRowTrouble(rowTrouble) }
  if (data.length === 0) return { error: 'No rows found under the header' }
  return withinLimit(data)
}

/**
 * papaparse renames a repeated header rather than failing -- `Name,Name` becomes `Name` and
 * `Name_1`, recorded in `meta.renamedHeaders` -- so the rows parse cleanly while one column is
 * keyed under a name no slot has, and silently prints blank. Caught from the header alone, before
 * the rows are trusted.
 */
function duplicateHeader(fields: string[], renamed: Record<string, string> | undefined): string | undefined {
  const [original] = Object.values(renamed ?? {})
  if (original !== undefined) return original
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field)) return field
    seen.add(field)
  }
  return undefined
}

function describeRowTrouble(errors: ParseError[]): string {
  const lines = errors.map((e) => {
    const what = FIELD_COUNT_TROUBLE[e.code] ?? e.message
    // `row` counts records, not lines in the file, so the header is not row 1 -- the same
    // numbering the job's per-row failures are reported with.
    return e.row === undefined ? what : `Row ${e.row + 1}: ${what}`
  })
  const head = lines.slice(0, 3).join('; ')
  return lines.length > 3 ? `${head} …and ${lines.length - 3} more` : head
}
