import { bytesToStream, readAll, type BlobStore } from './blobStore.js'

export function createMemoryBlobStore(): BlobStore & { paths(): string[] } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  return {
    async put(path, body, contentType) {
      objects.set(path, { bytes: body instanceof Uint8Array ? body : await readAll(body), contentType })
    },
    async get(path) {
      const o = objects.get(path)
      return o ? { stream: bytesToStream(o.bytes), contentType: o.contentType } : null
    },
    async delete(paths) {
      for (const p of paths) objects.delete(p)
    },
    paths: () => Array.from(objects.keys()),
  }
}
