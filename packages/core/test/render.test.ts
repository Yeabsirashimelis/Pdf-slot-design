import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test, vi } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { normalizePdf } from '../src/document/normalize.js'
import type { Slot } from '../src/document/types.js'
import { extractContentStreamText } from './helpers/content-stream.js'

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
  // extractContentStreamText() would return '' and this would fail.
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot()], fonts)
  expect(extractContentStreamText(out)).toMatch(/\bTj\b/)
})

test('empty slot text draws nothing and does not throw', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ text: '' })], fonts)
  expect(out.byteLength).toBeGreaterThan(0)
  expect(extractContentStreamText(out)).not.toMatch(/\bTj\b/)
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
