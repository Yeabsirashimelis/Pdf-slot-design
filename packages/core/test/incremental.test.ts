import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, degrees } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf, renderPdfIncremental } from '../src/render/pdf.js'
import { normalizePdf } from '../src/document/normalize.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import type { Slot } from '../src/document/types.js'
import { requireContentStreamText } from './helpers/content-stream.js'
import { markedStreamsPerPage } from './helpers/marked-streams.js'

/**
 * A second download after further edits must not start from the source
 * again: it appends an increment to the file the user already has, the
 * way every PDF editor that "saves" (rather than "exports") does. The
 * increment replaces this tool's own text -- and only that -- with the
 * current slots, so the result is equivalent to a from-scratch render of
 * the same slots, just cheaper and with the original bytes untouched.
 */

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(dir + FONT_FILES[id]))]),
) as FontBytes

async function blankDoc(rotation = 0) {
  const d = await PDFDocument.create()
  d.addPage([595.28, 841.89]).setRotation(degrees(rotation))
  d.addPage([595.28, 841.89])
  return normalizePdf(await d.save(), 'doc')
}

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 's1', page: 0, x: 50, y: 700, width: 300,
  text: 'Alpha', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
  ...over,
})

/** Every `Tm ... Tj` pair in document order: the six matrix numbers. */
function textMatrices(streamText: string): number[][] {
  const re = /([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) Tm\s*\n<[0-9A-F]*> Tj/g
  return Array.from(streamText.matchAll(re), (m) => m.slice(1, 7).map(Number))
}

test('the increment is appended: the previous file is a byte-for-byte prefix', async () => {
  const first = await renderPdf(await blankDoc(), [slot()], fonts)
  const second = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)
  expect(second.length).toBeGreaterThan(first.length)
  expect(Buffer.from(second.subarray(0, first.length)).equals(Buffer.from(first))).toBe(true)
})

test('an edited slot replaces the previously drawn text instead of stacking on it', async () => {
  const first = await renderPdf(await blankDoc(), [slot({ text: 'Alpha' })], fonts)
  const second = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)

  // Exactly one live marked stream per page that has slots; the superseded
  // one is out of the page's Contents (it is still in the file, as every
  // incremental update leaves its history behind, but is no longer drawn).
  expect(await markedStreamsPerPage(second)).toEqual([1, 0])

  // What is actually drawn on page 0 is the from-scratch equivalent.
  const scratch = await renderPdf(await blankDoc(), [slot({ text: 'Beta' })], fonts)
  const [drawnIncremental] = textMatrices(requireContentStreamText(second)).slice(-1)
  const [drawnScratch] = textMatrices(requireContentStreamText(scratch))
  expect(drawnIncremental).toEqual(drawnScratch)
})

test('a deleted slot disappears from the page', async () => {
  const first = await renderPdf(await blankDoc(), [slot({ text: 'Alpha' })], fonts)
  const second = await renderPdfIncremental(first, [], fonts)
  expect(await markedStreamsPerPage(second)).toEqual([0, 0])
  const loaded = await PDFDocument.load(second)
  expect(loaded.getPageCount()).toBe(2)
})

test('slots on several pages and a rotated page all land where a scratch render puts them', async () => {
  const doc = await blankDoc(90)
  const slots = [slot({ id: 'a', page: 0, x: 100, y: 300, text: 'Rotated' }), slot({ id: 'b', page: 1, text: 'Plain' })]
  const first = await renderPdf(doc, [slot({ id: 'a', page: 0, text: 'Old' })], fonts)
  const second = await renderPdfIncremental(first, slots, fonts)
  const scratch = await renderPdf(doc, slots, fonts)
  expect(await markedStreamsPerPage(second)).toEqual([1, 1])
  // The last two Tm...Tj pairs in the incremental file are the live ones.
  expect(textMatrices(requireContentStreamText(second)).slice(-2)).toEqual(
    textMatrices(requireContentStreamText(scratch)),
  )
})

test('consecutive increments chain: each one is a prefix of the next', async () => {
  const first = await renderPdf(await blankDoc(), [slot({ text: 'One' })], fonts)
  const second = await renderPdfIncremental(first, [slot({ text: 'Two' })], fonts)
  const third = await renderPdfIncremental(second, [slot({ text: 'Three' })], fonts)
  expect(Buffer.from(third.subarray(0, second.length)).equals(Buffer.from(second))).toBe(true)
  expect(await markedStreamsPerPage(third)).toEqual([1, 0])
  expect(requireContentStreamText(third)).toMatch(/\bTj\b/)
})

test('an increment is deterministic for identical input', async () => {
  const first = await renderPdf(await blankDoc(), [slot()], fonts)
  const a = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)
  const b = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
})

test('the source document itself (never rendered by this tool) is a valid starting point', async () => {
  // A user who downloaded the untouched original and then edits: there is
  // no marked stream to strip, so this degenerates to a plain increment.
  const doc = await blankDoc()
  const out = await renderPdfIncremental(doc.source, [slot()], fonts)
  expect(await markedStreamsPerPage(out)).toEqual([1, 0])
  expect(requireContentStreamText(out)).toMatch(/\bTj\b/)
})
