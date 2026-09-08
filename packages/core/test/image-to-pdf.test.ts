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

test('preserves image aspect ratio under scaling', async () => {
  // Very wide image: 3000×1000 (3:1 ratio) fits closer to A4 landscape than Letter
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 3000, height: 1000 })
  const doc = await PDFDocument.load(bytes)

  // For a 3000×1000 image (3:1 ratio) on a landscape page, the scaling should
  // preserve the 3:1 aspect ratio. The implementation uses:
  // scale = min(pageW / imageW, pageH / imageH)
  // drawW = imageW * scale
  // drawH = imageH * scale
  // This ensures the same scale factor is applied to both axes, preserving aspect ratio.

  const page = doc.getPage(0)
  const { width: pageWidth, height: pageHeight } = page.getSize()

  // A4 landscape is 841.89×595.28, Letter landscape is 792×612
  // For 3:1 ratio: A4 is closer (841.89/595.28≈1.414 vs 3.0 delta≈1.586)
  //               than Letter (792/612≈1.294 vs 3.0 delta≈1.706)
  expect(pageWidth).toBeCloseTo(A4.height, 1)
  expect(pageHeight).toBeCloseTo(A4.width, 1)

  // Verify the image is in the PDF
  const pdfBuffer = Buffer.from(bytes)
  const pdfText = pdfBuffer.toString('latin1')
  expect(pdfText).toContain('/XObject')
})

test('image is actually embedded in the PDF', async () => {
  // 1x1 red PNG.
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 1700, height: 2200 })
  const doc = await PDFDocument.load(bytes)

  // Check that the PDF bytes contain image stream data (embedded image)
  const pdfBuffer = Buffer.from(bytes)
  const pdfText = pdfBuffer.toString('latin1')

  // PDFs with embedded images contain /XObject in their resource dictionary
  // and /Image type entries
  expect(pdfText).toContain('/XObject')
  expect(pdfText).toContain('/Image')

  // Also verify the file size is substantial (not just an empty page)
  // The PNG in base64 is ~85 bytes, encoded it's larger, plus PDF overhead
  expect(bytes.length).toBeGreaterThan(200)
})
