import { PDFDocument, PDFName, PDFStream } from '@cantoo/pdf-lib'
import { SLOT_STREAM_MARKER } from '../../src/render/pdf.js'

/**
 * Per page, how many refs in its Contents array carry this tool's marker:
 * the number of slot-text streams currently live on that page. A page
 * this tool drew on has exactly one; anything else means an earlier
 * render's text was left in place (or was stripped without replacement).
 */
export async function markedStreamsPerPage(bytes: Uint8Array): Promise<number[]> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPages().map((page) => {
    const contents = page.node.normalizedEntries().Contents
    if (!contents) return 0
    let n = 0
    for (let i = 0; i < contents.size(); i++) {
      const obj = pdf.context.lookup(contents.get(i))
      if (obj instanceof PDFStream && obj.dict.has(PDFName.of(SLOT_STREAM_MARKER))) n++
    }
    return n
  })
}
