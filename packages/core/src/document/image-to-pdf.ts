import { PDFDocument } from '@cantoo/pdf-lib'
import { fitPageSize } from './page-fit'

export type EncodedImage = {
  bytes: Uint8Array
  format: 'png' | 'jpeg'
  width: number
  height: number
}

/** Wrap an encoded image in a single-page PDF sized to the nearest standard page. */
export async function imageToPdf(image: EncodedImage): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const size = fitPageSize(image.width, image.height)
  const page = doc.addPage([size.width, size.height])

  const embedded = image.format === 'png'
    ? await doc.embedPng(image.bytes)
    : await doc.embedJpg(image.bytes)

  // Scale image to fit within the page while preserving aspect ratio
  const scale = Math.min(size.width / image.width, size.height / image.height)
  const drawW = image.width * scale
  const drawH = image.height * scale
  const x = (size.width - drawW) / 2
  const y = (size.height - drawH) / 2

  page.drawImage(embedded, { x, y, width: drawW, height: drawH })
  return doc.save()
}
