import type { EncodedImage } from '@pdf-slot/core'

/**
 * Normalise any browser-decodable image to PNG bytes. pdf-lib embeds only
 * PNG and JPEG (see image-to-pdf.ts in @pdf-slot/core), so WebP and HEIC are
 * re-encoded here via canvas rather than rejected -- this is also the one
 * place a format the browser cannot decode at all fails cleanly, instead of
 * surfacing as a confusing downstream error.
 */
export async function decodeImage(file: File): Promise<EncodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This browser cannot read that image format.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a canvas to read the image.')
  ctx.drawImage(bitmap, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not convert the image.')

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    format: 'png',
    width: bitmap.width,
    height: bitmap.height,
  }
}
