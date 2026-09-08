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

  page.drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height })
  return doc.save()
}
