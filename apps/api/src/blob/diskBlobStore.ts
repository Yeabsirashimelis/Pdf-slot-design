import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bytesToStream, readAll, type BlobStore } from './blobStore.js'

export function createDiskBlobStore(dir: string): BlobStore {
  const file = (p: string) => path.join(dir, p)
  return {
    async put(p, body, contentType) {
      await mkdir(path.dirname(file(p)), { recursive: true })
      await writeFile(file(p), body instanceof Uint8Array ? body : await readAll(body))
      await writeFile(file(p) + '.type', contentType)
    },
    async get(p) {
      try {
        const [bytes, contentType] = await Promise.all([readFile(file(p)), readFile(file(p) + '.type', 'utf8')])
        return { stream: bytesToStream(new Uint8Array(bytes)), contentType }
      } catch { return null }
    },
    async delete(paths) {
      await Promise.all(paths.flatMap((p) => [rm(file(p), { force: true }), rm(file(p) + '.type', { force: true })]))
    },
  }
}
