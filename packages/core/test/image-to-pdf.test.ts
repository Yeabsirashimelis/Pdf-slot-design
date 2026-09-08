import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib'
import { expect, test, vi } from 'vitest'
import { A4, LETTER, fitPageSize } from '../src/document/page-fit.js'
import { imageToPdf } from '../src/document/image-to-pdf.js'

/**
 * The page's own content stream, decoded. pdf-lib writes `Contents` as an
 * array of stream references, so this resolves each one and concatenates
 * them -- the operators that actually paint this page, as opposed to
 * whatever objects happen to exist elsewhere in the file.
 */
function pageContentStream(page: PDFPage): string {
  const contents = page.node.context.lookup(page.node.Contents(), PDFArray)
  return contents
    .asArray()
    .map((ref) => {
      const stream = page.node.context.lookup(ref, PDFStream)
      if (!(stream instanceof PDFRawStream)) {
        throw new Error('Expected an undecoded raw content stream on the page')
      }
      return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
    })
    .join('\n')
}

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

  // Spy on the drawImage method to verify it receives the correct dimensions
  const spy = vi.spyOn(PDFPage.prototype, 'drawImage')

  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 3000, height: 1000 })

  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  const { width: pageWidth, height: pageHeight } = page.getSize()

  // A4 landscape is 841.89×595.28, Letter landscape is 792×612
  // For 3:1 ratio: A4 is closer (841.89/595.28≈1.414 vs 3.0 delta≈1.586)
  //               than Letter (792/612≈1.294 vs 3.0 delta≈1.706)
  expect(pageWidth).toBeCloseTo(A4.height, 1)
  expect(pageHeight).toBeCloseTo(A4.width, 1)

  // Most importantly: verify drawImage was called with geometry that preserves aspect ratio
  // Scale: min(841.89/3000, 595.28/1000) = 0.2806 (width-constrained)
  // drawW = 3000 * 0.2806 ≈ 841.89
  // drawH = 1000 * 0.2806 ≈ 280.63
  // x = (841.89 - 841.89) / 2 = 0
  // y = (595.28 - 280.63) / 2 ≈ 157.33

  expect(spy).toHaveBeenCalled()
  const callArgs = spy.mock.calls[0]?.[1] as { x: number; y: number; width: number; height: number } | undefined
  expect(callArgs).toBeDefined()

  if (callArgs) {
    // Verify the drawn aspect ratio matches the source (3:1), not the page ratio (~1.414)
    const drawnRatio = callArgs.width / callArgs.height
    expect(drawnRatio).toBeCloseTo(3.0, 1) // Source ratio

    // Verify horizontal centering (x should be ~0)
    expect(callArgs.x).toBeCloseTo(0, 0)

    // Verify vertical centering (y should be roughly half the vertical margin)
    // margin = 595.28 - 280.63 ≈ 314.65, half = 157.3
    expect(callArgs.y).toBeCloseTo(157.3, 0)
  }

  spy.mockRestore()
})

test('the image is placed on the page, not merely present in the file', async () => {
  // The previous version of this test asserted only that the saved bytes
  // contained /XObject and /Image. They do -- embedPng() followed by save()
  // emits both with no drawImage() call at all, verified. That proves an
  // image object exists somewhere in the file, which is not the
  // requirement. This checks the page: its resource dictionary names
  // exactly one XObject, and the page's own content stream invokes that
  // same name with `Do`.
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
  const bytes = await imageToPdf({ bytes: png, format: 'png', width: 1700, height: 2200 })
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)

  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
  expect(xobjects).toBeDefined()
  const names = xobjects!.keys().map((key) => key.asString())
  expect(names).toHaveLength(1)

  expect(pageContentStream(page)).toContain(`${names[0]} Do`)
})
