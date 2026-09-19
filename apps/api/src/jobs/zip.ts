import { Zip, ZipPassThrough } from 'fflate'

/**
 * A zip as a stream, one entry at a time, so a thousand PDFs never sit in
 * memory together. Entries are stored, not deflated: PDF streams are
 * already compressed, so deflate would only spend CPU.
 */
export function zipStream(entries: AsyncIterable<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return }
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      try {
        for await (const { name, bytes } of entries) {
          const entry = new ZipPassThrough(name)
          zip.add(entry)
          entry.push(bytes, true)
        }
        zip.end()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
