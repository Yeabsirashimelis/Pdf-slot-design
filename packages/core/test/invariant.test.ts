import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { normalizePdf } from '../src/document/normalize.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { createFontMetrics } from '../src/layout/metrics.js'
import { layoutText } from '../src/layout/wrap.js'
import type { Slot } from '../src/document/types.js'
import { extractContentStreamText } from './helpers/content-stream.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(dir + FONT_FILES[id]))]),
) as FontBytes

const slots: Slot[] = [
  {
    id: 'a', page: 0, x: 40, y: 760, width: 260,
    text: 'Acme Construction Company Ltd\n789 Maple Street',
    fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 },
    align: 'left', lineHeight: 1.2,
  },
]

async function doc() {
  const d = await PDFDocument.create()
  d.addPage([595.28, 841.89])
  return normalizePdf(await d.save(), 'doc')
}

/**
 * Each drawn line opens its own `BT ... ET` block. pdf-lib's drawText()
 * writes an unrotated text matrix as `1 0 0 1 x y Tm` immediately before
 * that line's `Tj`, with `x, y` the position it actually placed the glyphs
 * at. Reading `x, y` off every such `Tm...Tj` pair, in document order, gives
 * the sequence of positions the export really drew -- independent of the
 * glyph encoding inside the `Tj` string itself.
 */
function extractDrawnPositions(streamText: string): Array<{ x: number; y: number }> {
  const tmThenTj = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*\n<[0-9A-F]*> Tj/g
  return Array.from(streamText.matchAll(tmThenTj), (m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }))
}

test('re-rendering unchanged state reproduces identical bytes', async () => {
  const d = await doc()
  const first = await renderPdf(d, slots, fonts)
  const second = await renderPdf(d, slots, fonts)
  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
})

test('every laid-out line fits inside its slot width', async () => {
  const slot = slots[0]!
  const metrics = createFontMetrics(fonts[slot.fontId])
  const predicted = layoutText(
    {
      text: slot.text, size: slot.size, width: slot.width,
      align: slot.align, lineHeight: slot.lineHeight,
      originX: slot.x, originY: slot.y,
    },
    metrics,
  )

  // Every predicted line must fit inside the slot box. If the engine ever
  // emits a line wider than the box, the export would visibly overflow.
  for (const line of predicted) {
    expect(metrics.widthOfText(line.text, slot.size)).toBeLessThanOrEqual(slot.width + 0.01)
  }
  expect(predicted.length).toBeGreaterThan(1)
})

test("the exported PDF's line breaks match what the layout engine predicted", async () => {
  // Narrow width + long text forces at least three wrapped lines -- enough
  // to actually exercise re-wrapping, not just a single accidental break.
  // `align: 'right'` is load-bearing here, not cosmetic: for a right-aligned
  // slot, layoutText() computes each line's `x` as
  // `originX + (width - widthOfText(line.text))` -- a direct function of
  // *what that line's text measures as*. A left-aligned slot's `x` is always
  // `originX` for every line regardless of content, which would make an x
  // comparison redundant with the line count below. Right-aligning turns the
  // drawn x-coordinate into a real fingerprint of which words landed on
  // which line.
  const slot: Slot = {
    id: 'wrap', page: 0, x: 40, y: 760, width: 160,
    text: 'Acme Construction Company Limited Corporation of America',
    fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 },
    align: 'right', lineHeight: 1.2,
  }

  const metrics = createFontMetrics(fonts[slot.fontId])
  const predicted = layoutText(
    {
      text: slot.text, size: slot.size, width: slot.width,
      align: slot.align, lineHeight: slot.lineHeight,
      originX: slot.x, originY: slot.y,
    },
    metrics,
  )
  expect(predicted.length).toBeGreaterThanOrEqual(3)

  const d = await doc()
  const out = await renderPdf(d, [slot], fonts)
  const streamText = extractContentStreamText(out)

  // pdf-lib draws each line as a glyph-code hex string (`<0001...> Tj`), not
  // readable ASCII, and it subsets the embedded face down to only the
  // glyphs used *per drawText call* -- so there is no exposed mapping back
  // from a hex glyph-code string to the original characters without
  // reimplementing that subset font's cmap. Three checks that don't require
  // decoding glyph codes stand in for "same lines, same order":
  //
  //   1. the number of text-showing operators equals the number of lines
  //      layoutText() predicted -- nothing re-wrapped, dropped, or merged.
  //      On its own this is count-only: a re-wrap that redistributes the
  //      same words across the same number of lines would still pass it.
  //   2. the x-coordinate pdf-lib actually wrote for each line, in document
  //      order, matches the x layoutText() computed for that same line. As
  //      explained above, this is content-dependent for a right-aligned
  //      slot -- a line ending up with different words measures a different
  //      width and lands at a different x, so this check *does* catch a
  //      same-count reflow that (1) alone would miss.
  //   3. the baseline y-coordinate for each line, in document order, matches
  //      the baselineY layoutText() computed -- confirming vertical/index
  //      correspondence (line i drawn at line i's height), independent of
  //      (2)'s horizontal, content-dependent check.
  const tjCount = (streamText.match(/\bTj\b/g) ?? []).length
  expect(tjCount).toBe(predicted.length)

  const drawnPositions = extractDrawnPositions(streamText)
  expect(drawnPositions).toHaveLength(predicted.length)
  predicted.forEach((line, i) => {
    expect(drawnPositions[i]?.x).toBeCloseTo(line.x, 3)
    expect(drawnPositions[i]?.y).toBeCloseTo(line.baselineY, 3)
  })
})
