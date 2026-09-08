import { PDFDocument, rgb } from '@cantoo/pdf-lib'
// fontkit@2.0.4's ESM build has no default export; its named exports
// (`create`, notably) satisfy @cantoo/pdf-lib's structural `Fontkit`
// interface directly via a namespace import. Never `@pdf-lib/fontkit`:
// that package crashes inside `TTFSubset.encode` on save when subsetting
// (see test/metrics-characterization.test.ts).
import * as fontkit from 'fontkit'
import type { EditorDocument, Slot } from '../document/types'
import type { FontBytes, FontId } from '../fonts/registry'
import { createFontMetrics } from '../layout/metrics'
import { layoutText } from '../layout/wrap'

/** Fixed so identical input yields identical bytes. */
const EPOCH = new Date(0)

export async function renderPdf(
  doc: EditorDocument, slots: Slot[], fonts: FontBytes,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(doc.source)
  pdf.registerFontkit(fontkit)

  const pages = pdf.getPages()
  const embedded = new Map<FontId, Awaited<ReturnType<typeof pdf.embedFont>>>()

  for (const slot of slots) {
    if (slot.text === '') continue
    const page = pages[slot.page]
    if (!page) continue

    let font = embedded.get(slot.fontId)
    if (!font) {
      font = await pdf.embedFont(fonts[slot.fontId], { subset: true })
      embedded.set(slot.fontId, font)
    }

    const lines = layoutText(
      {
        text: slot.text, size: slot.size, width: slot.width,
        align: slot.align, lineHeight: slot.lineHeight,
        originX: slot.x, originY: slot.y,
      },
      createFontMetrics(fonts[slot.fontId]),
    )

    for (const line of lines) {
      if (line.text === '') continue
      page.drawText(line.text, {
        x: line.x,
        y: line.baselineY,
        size: slot.size,
        font,
        color: rgb(slot.color.r, slot.color.g, slot.color.b),
      })
    }
  }

  // Pin every source of nondeterminism so repeated renders are byte-identical.
  pdf.setCreationDate(EPOCH)
  pdf.setModificationDate(EPOCH)
  return pdf.save({ useObjectStreams: false })
}
