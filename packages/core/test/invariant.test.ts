import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { normalizePdf } from '../src/document/normalize.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { createFontMetrics } from '../src/layout/metrics.js'
import { layoutText, slotInset, slotLayout } from '../src/layout/wrap.js'
import { tableCells, tableFromStored, type TemplateTable } from '../src/document/table.js'
import type { Slot } from '../src/document/types.js'
import { requireContentStreamText } from './helpers/content-stream.js'

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
  const streamText = requireContentStreamText(out)

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

/**
 * A change-order log's first three rows: four columns lined up with a
 * printed form, padded so the text is held off the rules.
 */
function paddedTable(padding: number): TemplateTable {
  return {
    id: 'tbl1',
    page: 0,
    x: 50,
    y: 668,
    columns: [
      { key: 'no', name: 'No.', width: 40 },
      { key: 'date', name: 'Date', width: 70 },
      { key: 'desc', name: 'Description', width: 300 },
      { key: 'amount', name: 'Amount', width: 102 },
    ],
    rowHeights: [22, 22, 22],
    style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2, padding },
  }
}

const ROWS = [
  ['1', '03/14', 'Additional lobby doors and hardware', '1,240.00'],
  ['2', '03/28', 'Ceiling grid rework, levels 2-3', '3,450.00'],
  ['3', '04/09', 'Electrical rough-in revisions', '2,180.00'],
]

/** The table's cells with the log's text in them, in reading order. */
function filledCells(padding: number): Slot[] {
  return tableCells(paddedTable(padding)).map((cell, i) => ({
    ...cell,
    text: ROWS[Math.floor(i / 4)]![i % 4]!,
  }))
}

/**
 * The guarantee this branch has to keep: a table's cells are ordinary
 * slots, and padding is taken off the box in one place, so what the
 * overlay draws and what the writer prints are the same numbers.
 *
 * This is the one to run after a merge. The overlay computes its lines
 * through `slotLayout`; so does `renderPdf`. If anything ever moves the
 * padding, the row geometry or the cell layout into one of them and not
 * the other, the positions below stop matching and this fails -- which is
 * the whole point, because on screen the drift would just look like text
 * sitting slightly wrong.
 */
test('a padded table prints exactly where the preview lays it out', async () => {
  const padding = 4
  const cells = filledCells(padding)
  expect(cells).toHaveLength(12)

  const metrics = createFontMetrics(fonts.sans)
  // Exactly what the overlay does for each cell (see slotBox.ts).
  const predicted = cells.flatMap((cell) => layoutText(slotLayout(cell, cell.text, metrics), metrics))
  expect(predicted.length).toBeGreaterThanOrEqual(12)

  const out = await renderPdf(await doc(), cells, fonts)
  const drawn = extractDrawnPositions(requireContentStreamText(out))

  expect(drawn).toHaveLength(predicted.length)
  predicted.forEach((line, i) => {
    expect(drawn[i]?.x).toBeCloseTo(line.x, 3)
    expect(drawn[i]?.y).toBeCloseTo(line.baselineY, 3)
  })
})

test('the padding is really in the exported page, not just in the preview', async () => {
  // The test above would pass just as well if padding were ignored by
  // both sides. This one proves it reached the page: the same table,
  // printed twice, lands its glyphs further in when it is padded.
  const metrics = createFontMetrics(fonts.sans)
  const positions = async (padding: number) => {
    const cells = filledCells(padding)
    const out = await renderPdf(await doc(), cells, fonts)
    return extractDrawnPositions(requireContentStreamText(out))
  }

  const plain = await positions(0)
  const padded = await positions(6)
  expect(padded).toHaveLength(plain.length)

  // How far in the cell can actually afford to go. A 22pt row holding
  // 10pt text has only so much to give, and `slotInset` is what decides
  // -- the same function the overlay measures with.
  const inset = slotInset(filledCells(6)[0]!, metrics)
  expect(inset).toBeGreaterThan(0)

  // Left-aligned text: every line starts one inset further right, and one
  // inset lower down the page (PDF y grows upward).
  plain.forEach((line, i) => {
    expect(padded[i]!.x - line.x).toBeCloseTo(inset, 3)
    expect(line.y - padded[i]!.y).toBeCloseTo(inset, 3)
  })

  // And asking for more than the row can spare changes nothing further:
  // the text stays inside the row instead of growing the box out of it.
  expect(slotInset(filledCells(50)[0]!, metrics)).toBeCloseTo(inset, 3)
  expect(metrics.ascender(10) - metrics.descender(10) + inset * 2).toBeLessThanOrEqual(22.001)
})

test('a table saved in the old shape still prints where it always did', async () => {
  // Rows used to be one height plus a pitch and a count. A merge that
  // loses the translation would not crash -- it would quietly draw the
  // rows in the wrong places, which is worse.
  const legacy = {
    ...paddedTable(0),
    rowHeights: undefined,
    rowHeight: 16,
    rowPitch: 22,
    rowCount: 3,
  }
  const restored = tableFromStored(legacy as never)
  expect(restored.rowHeights).toEqual([22, 22, 22])

  const tops = tableCells(restored).filter((_, i) => i % 4 === 0).map((cell) => cell.y)
  expect(tops).toEqual([668, 646, 624])
})
