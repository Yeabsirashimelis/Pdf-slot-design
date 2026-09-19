import { del, get, put } from '@vercel/blob'
import type { BlobStore } from './blobStore.js'

export function createVercelBlobStore(token: string): BlobStore {
  return {
    async put(path, body, contentType) {
      await put(path, body instanceof Uint8Array ? Buffer.from(body) : body, {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        token,
      })
    },
    async get(path) {
      const result = await get(path, { access: 'private', token })
      if (!result || result.statusCode !== 200) return null
      return { stream: result.stream, contentType: result.blob.contentType }
    },
    async delete(paths) {
      if (paths.length > 0) await del(paths, { token })
    },
  }
}
