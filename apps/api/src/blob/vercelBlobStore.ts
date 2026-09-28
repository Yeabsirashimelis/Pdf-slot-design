import { del, get, put } from '@vercel/blob'
import type { BlobStore } from './blobStore.js'

export function createVercelBlobStore(token: string): BlobStore {
  return {
    async put(path, body, contentType) {
      const isStream = !(body instanceof Uint8Array)
      await put(path, isStream ? body : Buffer.from(body), {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        // The SDK refuses an existing pathname by default. Overwrite is required here: `PUT /files/:id`
        // is idempotent (a re-upload of the same file replaces its bytes), and Workflow may retry
        // `renderBatch` / `finishJob` after their blob was already written. The memory/disk stores
        // overwrite silently, and the contract tests on them document this as the BlobStore rule.
        allowOverwrite: true,
        // A stream is only ever a job zip, which can be large: multipart uploads it in parts and retries a failed part.
        multipart: isStream,
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
