/// <reference lib="dom.asynciterable" />
/**
 * Where bytes live: source PDFs, generated PDFs, zips. Private objects,
 * addressed by pathname, served only through the API. Vercel Blob in
 * production; an in-memory map in tests.
 */
export interface BlobStore {
  put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string): Promise<void>
  /** null when the path does not exist. */
  get(path: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null>
  delete(paths: string[]): Promise<void>
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

export const bytesToStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
