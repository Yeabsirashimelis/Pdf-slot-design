import type { Slot } from '../document/types'
import type { MetricsProvider } from './metrics'

/** A slot whose text contains characters its own face cannot encode. */
export type UnsupportedSlot = {
  slotId: string
  /** Deduped, in first-seen order. */
  characters: string[]
}

/**
 * Line separators `layoutText` consumes rather than draws.
 *
 * They matter because `\n` and `\r` are themselves unmapped in every
 * bundled face (`glyphForCodePoint(10).id === 0`), so a plain multi-line
 * slot would otherwise be reported as unsupported and blocked from export.
 * `layoutText` normalizes `\r\n`/`\r` to `\n` and splits on it, so neither
 * character ever reaches `drawText`. A **tab** is deliberately not in this
 * set: nothing splits on it, so it is passed straight to `drawText` and
 * really does come out as a `.notdef` box.
 */
const CONSUMED_BY_LAYOUT = /[\r\n]/g

/**
 * Every slot that would export `.notdef` boxes, and which characters cause
 * it. An empty array means the whole document is safe to export.
 *
 * This is the gate spec §8 requires. It has to be ours: `pdf-lib` does not
 * raise on unencodable input (contrary to what §8 originally claimed) --
 * `drawText` maps an unmapped code point to glyph 0 and `save()` succeeds,
 * so the download looks fine and renders empty boxes. Checking here, per
 * slot with that slot's own face, is also the only correct place: `mono`
 * covers Latin but not Cyrillic, so the answer depends on `slot.fontId`,
 * not on the text alone.
 */
export function findUnsupportedSlots(
  slots: Slot[],
  metrics: MetricsProvider,
): UnsupportedSlot[] {
  const findings: UnsupportedSlot[] = []
  for (const slot of slots) {
    const drawable = slot.text.replace(CONSUMED_BY_LAYOUT, '')
    if (drawable === '') continue
    const characters = metrics(slot.fontId).unsupportedCharacters(drawable)
    if (characters.length > 0) findings.push({ slotId: slot.id, characters })
  }
  return findings
}

/** Every offending character across `findings`, deduped, in first-seen order. */
export function collectUnsupportedCharacters(findings: UnsupportedSlot[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const finding of findings) {
    for (const character of finding.characters) {
      if (seen.has(character)) continue
      seen.add(character)
      result.push(character)
    }
  }
  return result
}

/** Names for characters that would otherwise be quoted as invisible nothing. */
const CONTROL_NAMES: Record<string, string> = {
  '\t': 'tab',
  '\v': 'vertical tab',
  '\f': 'form feed',
  ' ': 'non-breaking space',
}

/**
 * Renders offending characters for a user-facing message. Spec §8 requires
 * *naming* them, and an unadorned `\t` names nothing at all -- a pasted tab
 * (the likeliest way to hit this: copying a cell out of a spreadsheet) would
 * show as an empty pair of quotes.
 */
export function describeUnsupportedCharacters(characters: string[]): string {
  return characters.map((c) => CONTROL_NAMES[c] ?? `“${c}”`).join(', ')
}
