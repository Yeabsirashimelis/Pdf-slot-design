import type { FontMetrics } from './metrics'

export type Align = 'left' | 'center' | 'right'

/** A single laid-out line. `x` and `baselineY` are PDF points. */
export type PositionedLine = { text: string; x: number; baselineY: number }

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

export function layoutHeight(lineCount: number, size: number, lineHeight: number): number {
  return lineCount * size * lineHeight
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
