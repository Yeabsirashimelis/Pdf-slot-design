import { EncryptedPDFError, PDFDocument } from '@cantoo/pdf-lib'
import { displayedPageSize, normalizeRotation } from '../geometry/rotation'
import { EncryptedPdfError, InvalidPdfError, type EditorDocument } from './types'

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46] // %PDF

function hasPdfHeader(bytes: Uint8Array): boolean {
  return PDF_HEADER.every((b, i) => bytes[i] === b)
}

export async function normalizePdf(bytes: Uint8Array, id: string): Promise<EditorDocument> {
  if (bytes.byteLength < 5 || !hasPdfHeader(bytes)) throw new InvalidPdfError()

  // Both PDFDocument.load and reading pages back out of the result must be
  // inside this try: for some malformed/truncated inputs, `load` resolves
  // "successfully" with a document whose internal structure is incomplete,
  // and the failure only surfaces when its pages are read. Leaving
  // getPages()/getSize() outside the try (as a naive reading suggests) lets
  // a raw, unwrapped parser error escape instead of a clean InvalidPdfError.
  try {
    const doc = await PDFDocument.load(bytes)
    return {
      id,
      source: bytes,
      // The size the page is *displayed* at, `/Rotate` applied -- the same
      // page pdf.js paints on the canvas and the user places slots on. See
      // geometry/rotation.ts for the two spaces involved.
      pages: doc
        .getPages()
        .map((p) => displayedPageSize(p.getSize(), normalizeRotation(p.getRotation().angle))),
    }
  } catch (cause) {
    // @cantoo/pdf-lib exports EncryptedPDFError as part of its public API
    // (re-exported from '@cantoo/pdf-lib' via api/errors), so we can compare
    // against the real class instead of string-matching an error name.
    if (cause instanceof EncryptedPDFError) throw new EncryptedPdfError()
    throw new InvalidPdfError()
  }
}
