import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { renderPdf } from '../src/render/pdf.js'
import { FONT_FILES, FONT_IDS, type FontBytes } from '../src/fonts/registry.js'
import { normalizePdf } from '../src/document/normalize.js'
import type { Slot } from '../src/document/types.js'

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

test('empty slot text produces no drawing but no error', async () => {
  const doc = await blankDoc()
  const out = await renderPdf(doc, [slot({ text: '' })], fonts)
  expect(out.byteLength).toBeGreaterThan(0)
})

test('rendering is deterministic for identical input', async () => {
  const doc = await blankDoc()
  const a = await renderPdf(doc, [slot()], fonts)
  const b = await renderPdf(doc, [slot()], fonts)
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
})
