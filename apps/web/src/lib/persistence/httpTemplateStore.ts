import { toast } from 'sonner'
import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import { apiErrorSchema, fileMetaSchema, storedFileSummarySchema, templateLayoutSchema, templateValuesSchema } from '@pdf-slot/contracts'
import type { StoredFileSummary, TemplateStore } from './templateStore'

let hasWarned = false
function warnUnreachable(): void {
  if (hasWarned) return
  hasWarned = true
  toast.warning("Your changes aren't reaching the server", {
    description: 'The API is unreachable. You can keep editing and downloading; saving will resume when it is back.',
  })
}

/**
 * A 4xx other than 404 is the server reaching us and rejecting the request
 * (bad input, a business rule like a duplicate slot name) -- not the API
 * being unreachable. Shown with its own reason every time: unlike
 * `warnUnreachable`, this never latches, because each rejection is new
 * information about the request that just failed.
 */
async function reportRejection(res: Response, method: string, path: string): Promise<void> {
  let message = `Request failed (${res.status})`
  try {
    const parsed = apiErrorSchema.safeParse(await res.json())
    if (parsed.success) message = parsed.data.error.message
  } catch {
    // Body wasn't our error envelope (or wasn't JSON at all) -- keep the generic message.
  }
  console.error(`${method} ${path} -> ${res.status}: ${message}`)
  toast.error(message)
}

/**
 * `TemplateStore` over the Hono API. Same contract as the IndexedDB store:
 * never rejects -- a failed request reads as "nothing saved" / drops the
 * write. Two failure modes are told apart: the API being unreachable
 * (network error, 5xx) warns once via `warnUnreachable`; the API being
 * reachable but rejecting the request (4xx other than 404) shows its own
 * reason every time via `reportRejection`, so a real server error is never
 * misreported as the API being down. Shapes are validated with the shared
 * contracts, so a server that drifts is caught here, not deep in the editor.
 */
export function createHttpTemplateStore(baseUrl: string): TemplateStore {
  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`

  async function request(path: string, init?: RequestInit): Promise<Response | null> {
    try {
      const res = await fetch(url(path), init)
      if (res.status === 404) return null
      if (res.status >= 400 && res.status < 500) {
        await reportRejection(res, init?.method ?? 'GET', path)
        return null
      }
      if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`)
      return res
    } catch (err) {
      console.error(err)
      warnUnreachable()
      return null
    }
  }
  const json = async <T>(path: string, parse: (raw: unknown) => T): Promise<T | null> => {
    const res = await request(path)
    if (!res) return null
    try { return parse(await res.json()) } catch (err) { console.error(err); return null }
  }
  const put = (path: string, body: unknown) =>
    request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => undefined)

  return {
    async getFile(fileId: FileId): Promise<StoredFile | null> {
      const meta = await json(`/files/${fileId}`, (raw) => fileMetaSchema.parse(raw))
      if (!meta) return null
      const res = await request(`/files/${fileId}/source`)
      if (!res) return null
      return { ...meta, source: new Uint8Array(await res.arrayBuffer()) }
    },
    async putFile(file: StoredFile): Promise<void> {
      const form = new FormData()
      form.set('meta', JSON.stringify({ name: file.name, pages: file.pages, createdAt: file.createdAt }))
      form.set('source', new Blob([Uint8Array.from(file.source)], { type: 'application/pdf' }), file.name)
      await request(`/files/${file.fileId}`, { method: 'PUT', body: form })
    },
    getLayout: (fileId) => json(`/files/${fileId}/layout`, (raw) => templateLayoutSchema.parse(raw) as TemplateLayout),
    putLayout: (layout) => put(`/files/${layout.fileId}/layout`, layout),
    getValues: (fileId) => json(`/files/${fileId}/values`, (raw) => templateValuesSchema.parse(raw) as TemplateValues),
    putValues: (values) => put(`/files/${values.fileId}/values`, values),
    async listFiles(): Promise<StoredFileSummary[]> {
      return (await json('/files', (raw) => storedFileSummarySchema.array().parse(raw))) ?? []
    },
    async deleteFile(fileId: FileId): Promise<void> {
      await request(`/files/${fileId}`, { method: 'DELETE' })
    },
  }
}
