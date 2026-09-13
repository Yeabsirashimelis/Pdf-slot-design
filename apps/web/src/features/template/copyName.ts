/** Matches "<base> copy" and "<base> copy (n)" -- the names this module hands out. */
const COPY_SUFFIX = /^(.*) copy(?: \((\d+)\))?$/

/**
 * The name for a duplicate of `source`: "<base> copy", or "<base> copy (n)"
 * with the smallest n >= 2 not already in `taken`. Duplicating a copy
 * derives from the same base ("six copy" -> "six copy (2)", never
 * "six copy copy"), and a number freed by a deletion is reused.
 */
export function copyName(source: string, taken: readonly string[]): string {
  const base = source.match(COPY_SUFFIX)?.[1] ?? source
  const used = new Set(taken)
  if (!used.has(`${base} copy`)) return `${base} copy`
  for (let n = 2; ; n++) {
    const candidate = `${base} copy (${n})`
    if (!used.has(candidate)) return candidate
  }
}
