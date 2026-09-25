import type { FontMetrics } from './metrics'
import type { Slot } from '../document/types'

export type Align = 'left' | 'center' | 'right'

/** A single laid-out line. `x` and `baselineY` are PDF points. */
export type PositionedLine = { text: string; x: number; baselineY: number }

/**
 * A box is never inset so far that there is no room left to read.
 * Narrower than this and a word breaks to one letter a line, which is
 * not text any more.
 */
export const MIN_TEXT_WIDTH = 12

export type LayoutInput = {
  text: string
  size: number
  width: number
  align: Align
  lineHeight: number
  /** Top-left corner of the slot box, in PDF points. */
  originX: number
  originY: number
}

/**
 * The height of the box that holds `lineCount` lines: the taller of the
 * line boxes (`lineCount * size * lineHeight`, which leaves the usual
 * leading under the last line) and the glyphs themselves -- from the
 * first line's ascender, down `lineCount - 1` steps, to the last line's
 * descender. The second term is what keeps a tight line height (below
 * ~1.3, where PT Sans's ascender + descender exceed the step) from
 * drawing a box the text hangs out of. Preview-only: the export places
 * text by baseline and never reads this.
 */
export function layoutHeight(lineCount: number, size: number, lineHeight: number, metrics: FontMetrics): number {
  const lineBoxes = lineCount * size * lineHeight
  // `descender` is negative (below the baseline), hence the subtraction.
  const glyphs = metrics.ascender(size) + (lineCount - 1) * size * lineHeight - metrics.descender(size)
  return Math.max(lineBoxes, glyphs)
}

/**
 * Splits a word into grapheme clusters rather than code points, so a hard
 * character break can never fall inside a multi-code-point cluster (e.g. a
 * base letter plus a combining diacritic) and strand a combining mark at the
 * start of the next line.
 *
 * `Intl.Segmenter` can in principle segment differently across JS engines.
 * That is safe here only because `layoutText` runs once per session and both
 * consumers (the overlay and the PDF writer) read that single output array —
 * they cannot disagree with each other even if a different browser would have
 * segmented differently. This reasoning holds only while both consumers share
 * one JS realm. If line breaking (or export) ever moves server-side, the
 * server and browser become different realms and this guarantee must be
 * re-checked.
 */
function graphemeClusters(word: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(word), (s) => s.segment)
}

function breakParagraph(
  paragraph: string, width: number, size: number, metrics: FontMetrics,
): string[] {
  if (paragraph === '') return ['']

  const lines: string[] = []
  let current = ''

  for (const word of paragraph.split(' ')) {
    const candidate = current === '' ? word : current + ' ' + word

    if (metrics.widthOfText(candidate, size) <= width) {
      current = candidate
      continue
    }

    if (current !== '') {
      lines.push(current)
      current = ''
    }

    // The word alone may still not fit; break it by character.
    if (metrics.widthOfText(word, size) <= width) {
      current = word
      continue
    }

    let chunk = ''
    for (const cluster of graphemeClusters(word)) {
      if (chunk !== '' && metrics.widthOfText(chunk + cluster, size) > width) {
        lines.push(chunk)
        chunk = cluster
      } else {
        chunk += cluster
      }
    }
    current = chunk
  }

  if (current !== '') lines.push(current)
  return lines.length === 0 ? [''] : lines
}

/**
 * What to lay out for a slot, its padding already taken off.
 *
 * Both the overlay and the PDF writer go through here rather than
 * building their own input, because the two must agree to the point:
 * preview equals download is decided by whether these numbers match.
 *
 * `text` is passed in rather than read off the slot because the overlay
 * also lays out a slot's *name*, as the placeholder in an empty box.
 */
export function slotLayout(slot: Slot, text: string, metrics?: FontMetrics): LayoutInput {
  const inset = slotInset(slot, metrics)
  return {
    text,
    size: slot.size,
    width: slot.width - inset * 2,
    align: slot.align,
    lineHeight: slot.lineHeight,
    originX: slot.x + inset,
    // PDF y grows upward, so insetting from the top means going down.
    originY: slot.y - inset,
  }
}

/**
 * The padding actually applied: never more than the box can spare.
 *
 * Two limits, and the tighter one wins. Across, the text must stay wide
 * enough to be a line rather than a column of single letters. Down, a box
 * with a height of its own -- a table's cell, which owns its row -- must
 * still hold one line inside its padding, or the text would push the box
 * past the row it belongs to and the table would come apart.
 */
export function slotInset(slot: Slot, metrics?: FontMetrics): number {
  const wanted = Math.max(0, slot.padding ?? 0)
  const across = Math.max(0, (slot.width - MIN_TEXT_WIDTH) / 2)
  const line = metrics ? metrics.ascender(slot.size) - metrics.descender(slot.size) : 0
  const down = slot.height === undefined ? Infinity : Math.max(0, (slot.height - line) / 2)
  return Math.min(wanted, across, down)
}

export function layoutText(input: LayoutInput, metrics: FontMetrics): PositionedLine[] {
  if (input.text === '') return []

  // Normalize CRLF and lone-CR (classic Mac) line endings to LF before
  // splitting. Left unnormalized, a trailing '\r' rides along as a literal
  // character in the returned line text -- and that same string is drawn by
  // both the overlay and the PDF writer, which can disagree on how a bare
  // '\r' renders (a browser text node silently drops it; a real embedded
  // font may measure it or show a .notdef box).
  const normalized = input.text.replace(/\r\n?/g, '\n')

  const raw = normalized
    .split('\n')
    .flatMap((p) => breakParagraph(p, input.width, input.size, metrics))

  const step = input.size * input.lineHeight
  const firstBaseline = input.originY - metrics.ascender(input.size)

  return raw.map((text, i) => {
    const lineWidth = metrics.widthOfText(text, input.size)
    const slack = input.width - lineWidth
    const dx = input.align === 'center' ? slack / 2 : input.align === 'right' ? slack : 0
    return {
      text,
      x: input.originX + dx,
      baselineY: firstBaseline - i * step,
    }
  })
}
