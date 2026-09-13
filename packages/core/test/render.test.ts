import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, degrees } from '@cantoo/pdf-lib'
import { expect, test, vi } from 'vitest'
import { readSourceStamp, renderPdf, renderPdfIncremental } from '../src/render/pdf.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { normalizePdf } from '../src/document/normalize.js'
import type { Slot } from '../src/document/types.js'
import { createFontMetrics } from '../src/layout/metrics.js'
import { extractContentStreamText, requireContentStreamText } from './helpers/content-stream.js'

const dir = fileURLToPath(new URL('../src/fonts/files/', import.meta.url))
const fonts = Object.fromEntries(
  FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(dir + FONT_FILES[id]))]),
) as FontBytes

async function blankDoc() {
  const d = await PDFDocument.create()
  d.addPage([595.28, 841.89])
  return normalizePdf(await d.save(), 'doc')
}

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 's1', page: 0, x: 50, y: 700, width: 300,
  text: 'Hello world', fontId: 'sans', size: 14,
  color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
  ...over,
})

test('output is a loadable PDF with the original page count', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  const loaded = await PDFDocument.load(out)
  expect(loaded.getPageCount()).toBe(1)
})

test('output preserves the original page size', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  const { width } = (await PDFDocument.load(out)).getPage(0).getSize()
  expect(width).toBeCloseTo(595.28, 2)
})

test('rendering with no slots still returns a valid PDF', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [], fonts)
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
})

test('a slot on a page that does not exist is ignored, not fatal', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ page: 7 })], fonts)
  expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
})

test('written content stream contains a text-showing operator for the drawn text', async () => {
  // Container-shaped assertions (page count, page size, byte length) all
  // pass against a build that draws nothing -- this checks the one thing
  // renderPdf exists to do: that text actually lands in the page's content
  // stream. A no-op drawText would leave no BT/ET block at all, so
  // extractContentStreamText() would return null and this would fail.
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  expect(requireContentStreamText(out)).toMatch(/\bTj\b/)
})

test('empty slot text draws nothing and does not throw', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ text: '' })], fonts)
  expect(out.byteLength).toBeGreaterThan(0)
  // toBeNull, not `.not.toMatch(/Tj/)`: a negative match against the
  // extractor's old '' return passed vacuously -- including if the
  // extractor itself had broken.
  expect(extractContentStreamText(out)).toBeNull()

  // Positive control, on the same extractor and the same document. Without
  // it the assertion above would still be green if extractContentStreamText
  // had stopped matching anything at all.
  const drawn = await renderPdf(doc, [slot({ text: 'x' })], fonts)
  expect(requireContentStreamText(drawn)).toMatch(/\bTj\b/)
})

test('a slot with empty text does not embed its font', async () => {
  // Exercises what the `slot.text === ''` guard in pdf.ts actually buys:
  // layoutText('') already returns [] unconditionally, so a drawing
  // assertion alone can't tell the guard apart from its absence -- deleting
  // the guard would still draw nothing. This is the guard's real, otherwise
  // untested effect: skipping a wasted embedFont call for the empty slot.
  const doc = await blankDoc()
  const embedSpy = vi.spyOn(PDFDocument.prototype, 'embedFont')
  try {
    await renderPdf(doc, [slot({ text: '' })], fonts)
    expect(embedSpy).not.toHaveBeenCalled()
  } finally {
    embedSpy.mockRestore()
  }
})

test('a non-black slot colour renders instead of throwing', async () => {
  // pdf-lib's rgb() asserts each component is within 0-1 and throws
  // otherwise ("`red` must be at least 0 and at most 1"). Every existing
  // render test used pure black, whose 0/0/0 is valid in either
  // convention, so nothing here noticed when the toolbar's palette was
  // authored in CSS bytes and every coloured slot crashed the export.
  const doc = await blankDoc()
  const out = await renderPdf(
    doc,
    [slot({ color: { r: 37 / 255, g: 99 / 255, b: 235 / 255 } })],
    fonts,
  )
  expect(requireContentStreamText(out)).toMatch(/\bTj\b/)
})

test('an out-of-range slot colour fails loudly at export', async () => {
  const doc = await blankDoc()
  await expect(renderPdf(doc, [slot({ color: { r: 37, g: 99, b: 235 } })], fonts)).rejects.toThrow()
})

test('rendering is deterministic for identical input', async () => {
  const doc = await blankDoc()
  const a = await renderPdf(doc, [slot()], fonts)
  const b = await renderPdf(doc, [slot()], fonts)
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
})

test('font metrics are parsed once per fontId, not once per slot', async () => {
  const doc = await blankDoc()
  const metrics = await import('../src/layout/metrics.js')
  const spy = vi.spyOn(metrics, 'createFontMetrics')
  try {
    await renderPdf(
      doc,
      [slot({ id: 's1', text: 'one' }), slot({ id: 's2', text: 'two', y: 600 })],
      fonts,
    )
    expect(spy).toHaveBeenCalledTimes(1)
  } finally {
    spy.mockRestore()
  }
})

/**
 * Reads every text matrix pdf-lib wrote immediately before a `Tj`, as the
 * six numbers of the `Tm` operator. The first four are the rotation part
 * (cos, sin, -sin, cos) and the last two the position -- so this tells
 * both *where* and *in which direction* the export drew each line.
 */
function extractTextMatrices(streamText: string): number[][] {
  const tmThenTj = /([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) Tm\s*\n<[0-9A-F]*> Tj/g
  return Array.from(streamText.matchAll(tmThenTj), (m) => m.slice(1, 7).map(Number))
}

test('on a /Rotate 90 page, text is drawn where the user placed it on the displayed page', async () => {
  // The slot model is in *displayed* page space (what the canvas shows and
  // the user clicks on); the page's content stream is in its unrotated
  // user space. Without mapping between the two, a slot placed on a
  // rotated page exports a quarter turn off, somewhere else on the page.
  const d = await PDFDocument.create()
  d.addPage([612, 792]).setRotation(degrees(90))
  const doc = await normalizePdf(await d.save(), 'rotated')
  expect(doc.pages[0]).toEqual({ width: 792, height: 612 })

  // 100pt from the left edge, 500pt up from the bottom of the *displayed*
  // (landscape) page. Rotation 90 turns that into unrotated
  // (612 - 500, 100) = (112, 100), with the baseline running "up" the
  // unrotated page so it reads left-to-right once the viewer rotates it.
  const out = await renderPdf(doc, [slot({ x: 100, y: 500, text: 'Hi' })], fonts)
  const [tm] = extractTextMatrices(requireContentStreamText(out))
  expect(tm).toBeDefined()
  const [a, b, c, dd, x, y] = tm!
  expect(a).toBeCloseTo(0, 6)
  expect(b).toBeCloseTo(1, 6)
  expect(c).toBeCloseTo(-1, 6)
  expect(dd).toBeCloseTo(0, 6)
  // y is the baseline: slot top (500) minus the face's ascender at 14pt.
  expect(x).toBeCloseTo(612 - (500 - createFontMetrics(fonts.sans).ascender(14)), 2)
  expect(y).toBeCloseTo(100, 2)
})

test('on an unrotated page the text matrix stays the identity rotation', async () => {
  const out = await renderPdf(await blankDoc(), [slot({ x: 100, y: 500, text: 'Hi' })], fonts)
  const [tm] = extractTextMatrices(requireContentStreamText(out))
  const [a, b, c, dd, x] = tm!
  expect([a, b, c, dd]).toEqual([1, 0, 0, 1])
  expect(x).toBeCloseTo(100, 2)
})

test('the export carries its source id in the Info dictionary, so a downloaded copy can find its layout', async () => {
  const doc = await blankDoc()
  const out = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  expect(await readSourceStamp(out)).toBe('abc123')
  // Still deterministic with the stamp in place.
  const again = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  expect(Buffer.from(out).equals(Buffer.from(again))).toBe(true)
})

test('an increment keeps the source stamp', async () => {
  const doc = await blankDoc()
  const first = await renderPdf({ ...doc, id: 'abc123' }, [slot()], fonts)
  const second = await renderPdfIncremental(first, [slot({ text: 'Beta' })], fonts)
  expect(await readSourceStamp(second)).toBe('abc123')
})

test('a PDF that was never exported by this tool has no stamp', async () => {
  const doc = await blankDoc()
  expect(await readSourceStamp(doc.source)).toBeNull()
})
