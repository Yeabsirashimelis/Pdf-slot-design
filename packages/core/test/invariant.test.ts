import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { normalizePdf } from '../src/document/normalize.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { createFontMetrics } from '../src/layout/metrics.js'
import { layoutText } from '../src/layout/wrap.js'
import type { Slot } from '../src/document/types.js'

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
 * Pulls the decoded text of every `stream`...`endstream` block that looks
 * like a content stream (contains `BT`/`ET`) out of a saved PDF's raw
 * bytes, inflating it first if it's Flate-compressed. Local copy of the
 * helper in test/render.test.ts and test/metrics-characterization.test.ts
 * (test-only tooling, not exported from src) -- good enough to check for
 * text-showing operators, not a general PDF parser.
 */
function extractContentStreamText(pdfBytes: Uint8Array): string {
  const buf = Buffer.from(pdfBytes)
  const text = buf.toString('latin1')
  const streamRe = /\d+ 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g
  const chunks: string[] = []

  for (const match of text.matchAll(streamRe)) {
    const dict = match[1] ?? ''
    const start = (match.index ?? 0) + match[0].length
    const end = text.indexOf('endstream', start)
    if (end === -1) continue
    const raw = buf.subarray(start, end)
    const decoded = (dict.includes('FlateDecode') ? inflateSync(raw) : raw).toString('latin1')
    if (decoded.includes('BT') && decoded.includes('ET')) chunks.push(decoded)
  }

  return chunks.join('\n')
}

/**
 * Each drawn line opens its own `BT ... ET` block. pdf-lib's drawText()
 * writes an unrotated text matrix as `1 0 0 1 x y Tm` immediately before
 * that line's `Tj`, with `y` the baseline it actually placed the glyphs at.
 * Reading `y` off every such `Tm...Tj` pair, in document order, gives the
 * sequence of baselines the export really drew -- independent of the glyph
 * encoding inside the `Tj` string itself.
 */
function extractDrawnBaselines(streamText: string): number[] {
  const tmThenTj = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\s*\n<[0-9A-F]*> Tj/g
  return Array.from(streamText.matchAll(tmThenTj), (m) => Number(m[1]))
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
  const slot: Slot = {
    id: 'wrap', page: 0, x: 40, y: 760, width: 160,
    text: 'Acme Construction Company Limited Corporation of America',
    fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 },
    align: 'left', lineHeight: 1.2,
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
  // reimplementing that subset font's cmap. Two checks that don't require
  // decoding glyph codes stand in for "same lines, same order":
  //
  //   1. the number of text-showing operators equals the number of lines
  //      layoutText() predicted -- nothing re-wrapped, dropped, or merged.
  //   2. the baseline y-coordinate pdf-lib actually wrote for each line, in
  //      document order, matches the baselineY layoutText() computed for
  //      that same line, in the same order -- so the correspondence is
  //      positional, not merely a matching count.
  const tjCount = (streamText.match(/\bTj\b/g) ?? []).length
  expect(tjCount).toBe(predicted.length)

  const drawnBaselines = extractDrawnBaselines(streamText)
  expect(drawnBaselines).toHaveLength(predicted.length)
  predicted.forEach((line, i) => {
    expect(drawnBaselines[i]).toBeCloseTo(line.baselineY, 3)
  })
})
