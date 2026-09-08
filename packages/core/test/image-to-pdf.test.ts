import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { A4, LETTER, fitPageSize } from '../src/document/page-fit.js'
import { imageToPdf } from '../src/document/image-to-pdf.js'

test('portrait photo maps to portrait A4 or Letter', () => {
  const s = fitPageSize(3024, 4032)         // 3:4
  expect(s.height).toBeGreaterThan(s.width)
})

test('landscape image produces a landscape page', () => {
  const s = fitPageSize(4032, 3024)
  expect(s.width).toBeGreaterThan(s.height)
})

test('US Letter aspect picks Letter over A4', () => {
  const s = fitPageSize(1700, 2200)         // exactly 8.5:11
  expect(s.width).toBeCloseTo(LETTER.width, 6)
  expect(s.height).toBeCloseTo(LETTER.height, 6)
})

test('A4 aspect picks A4', () => {
  const s = fitPageSize(2480, 3508)         // 210:297 at 300dpi
  expect(s.width).toBeCloseTo(A4.width, 6)
})

test('produces a single-page PDF at the fitted size', async () => {
  // 1x1 red PNG.
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 1700, height: 2200 })
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBe(1)
  const { width, height } = doc.getPage(0).getSize()
  expect(width).toBeCloseTo(LETTER.width, 1)
  expect(height).toBeCloseTo(LETTER.height, 1)
})
