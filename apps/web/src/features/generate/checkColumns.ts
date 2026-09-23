export type ColumnCheck = {
  /** The keys of the first record, in order. */
  columns: string[]
  /** Columns that name no slot: their values are printed nowhere. */
  unknown: string[]
  /** Slots no column fills: they are printed blank. */
  missing: string[]
  /** For an unknown column, the slot it was most likely meant to be. */
  suggestions: Record<string, string>
}

/** Beyond two edits apart, "did you mean" stops being help and starts being noise. */
const MAX_TYPO_DISTANCE = 2

/**
 * Holds the data's columns up against the slots on the page.
 *
 * Neither list being a subset of the other is legitimate -- a spreadsheet may carry columns this
 * template does not print, and a slot may be meant to stay blank -- so nothing here is an error.
 * It exists so a mistyped column is seen before it prints 5000 blank PDFs.
 */
export function checkColumns(records: readonly Record<string, string>[], slotNames: readonly string[]): ColumnCheck {
  const first = records[0]
  // Nothing to hold anything up against: with no rows, every slot would read as "missing", which
  // tells the user nothing they did not already know.
  if (!first) return { columns: [], unknown: [], missing: [], suggestions: {} }
  const columns = Object.keys(first)
  // Exact and case-sensitive: slot names are matched that way everywhere else, and the summary
  // would be lying if it showed a column as matched that the renderer will not match.
  const named = new Set(slotNames)
  const covered = new Set(columns)
  const unknown = columns.filter((c) => !named.has(c))
  const missing = [...new Set(slotNames)].filter((name) => !covered.has(name))
  const suggestions: Record<string, string> = {}
  for (const column of unknown) {
    const slot = nearestSlot(column, slotNames)
    if (slot !== undefined) suggestions[column] = slot
  }
  return { columns, unknown, missing, suggestions }
}

function nearestSlot(column: string, slotNames: readonly string[]): string | undefined {
  // Compared without case or surrounding space, so "name" and " Name " are zero edits from
  // "Name" and are suggested outright, while "Nmae" is the two edits the threshold allows.
  const wanted = column.trim().toLowerCase()
  let best: string | undefined
  let shortest = MAX_TYPO_DISTANCE + 1
  for (const name of slotNames) {
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
