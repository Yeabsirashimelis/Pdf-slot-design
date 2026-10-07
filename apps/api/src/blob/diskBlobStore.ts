import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bytesToStream, readAll, type BlobStore } from './blobStore.js'

export function createDiskBlobStore(dir: string): BlobStore {
  const root = path.resolve(dir)
  const file = (p: string) => {
    const resolved = path.resolve(root, p)
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error('Blob path escapes the store: ' + p)
    }
    return resolved
  }
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
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
    },
    async delete(paths) {
      await Promise.all(paths.flatMap((p) => [rm(file(p), { force: true }), rm(file(p) + '.type', { force: true })]))
    },
  }
}
