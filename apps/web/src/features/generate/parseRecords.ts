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

/** RFC 4180: fields separated by commas, optionally quoted, quotes doubled inside, CRLF or LF rows. */
function parseCsv(text: string): ParsedRecords {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  const [header, ...body] = rows
  if (!header) return { error: 'No header row' }
  if (body.length === 0) return { error: 'No rows under the header' }
  return { records: body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))) }
}
