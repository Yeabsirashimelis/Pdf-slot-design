import { PDFDocument } from '@cantoo/pdf-lib'
import { expect, test } from 'vitest'
import { normalizePdf } from '../src/document/normalize.js'
import { InvalidPdfError } from '../src/document/types.js'

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595.28, 841.89]) // A4
  doc.addPage([612, 792]) // Letter
  return doc.save()
}

test('reads page sizes in order', async () => {
  const d = await normalizePdf(await twoPagePdf(), 'doc-1')
  expect(d.pages).toHaveLength(2)
  expect(d.pages[0]!.width).toBeCloseTo(595.28, 2)
  expect(d.pages[1]!.height).toBeCloseTo(792, 2)
})

test('preserves the id and source bytes', async () => {
  const bytes = await twoPagePdf()
  const d = await normalizePdf(bytes, 'doc-2')
  expect(d.id).toBe('doc-2')
  expect(d.source).toEqual(bytes)
})

test('rejects bytes that are not a PDF', async () => {
  await expect(normalizePdf(new Uint8Array([1, 2, 3, 4, 5]), 'x')).rejects.toBeInstanceOf(
    InvalidPdfError,
  )
})

test('rejects truncated PDF bytes as invalid', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([100, 100])
  const bytes = await doc.save()
  // Truncating a valid PDF after the header leaves a file pdf-lib cannot
  // parse. This exercises the "malformed, not encrypted" branch of
  // normalizePdf deterministically.
  //
  // There is no fixture here for the *encrypted* branch: pdf-lib can create
  // PDFDocuments but has no API to write an encrypted PDF, so we cannot
  // construct bytes that would take that path. EncryptedPdfError and its
  // detection logic are exercised by manual verification instead (see
  // Task 13), not by this suite.
  await expect(normalizePdf(bytes.slice(0, 20), 'x')).rejects.toBeInstanceOf(InvalidPdfError)
})
