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
 * The platform in front of the API caps a request body at 4.5 MB and answers
 * a 413 itself, with a plain-text body our envelope parser cannot read. Only
 * `PUT /files/:id` carries a body that size, so the message names the PDF.
 */
const UPLOAD_TOO_LARGE = 'This PDF is too large to save on the server (limit 4.5 MB). You can still edit and download it.'

/** A caller-supplied reason for a status whose body the server does not explain in our envelope. */
type RequestOptions = { rejectionMessages?: Readonly<Record<number, string>> }

/**
 * A 4xx other than 404 is the server reaching us and rejecting the request
 * (bad input, a business rule like a duplicate slot name) -- not the API
 * being unreachable. Shown with its own reason every time: unlike
 * `warnUnreachable`, this never latches, because each rejection is new
 * information about the request that just failed. A `known` message wins
 * over the body: it is for statuses the platform answers on our behalf.
 */
async function reportRejection(res: Response, method: string, path: string, known?: string): Promise<void> {
  let message = known ?? `Request failed (${res.status})`
  if (!known) {
    try {
      const parsed = apiErrorSchema.safeParse(await res.json())
      if (parsed.success) message = parsed.data.error.message
    } catch {
      // Body wasn't our error envelope (or wasn't JSON at all) -- keep the generic message.
    }
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

  async function request(path: string, init?: RequestInit, options?: RequestOptions): Promise<Response | null> {
    try {
      const res = await fetch(url(path), init)
      if (res.status === 404) return null
      if (res.status >= 400 && res.status < 500) {
        await reportRejection(res, init?.method ?? 'GET', path, options?.rejectionMessages?.[res.status])
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
      // Reading the body is a second network operation that can fail on its own (the connection
      // dropped after the headers arrived), so it is guarded exactly like the request: the store
      // never rejects, and a failed read is "nothing saved" plus the one-time unreachable warning.
      try {
        return { ...meta, source: new Uint8Array(await res.arrayBuffer()) }
      } catch (err) {
        console.error(err)
        warnUnreachable()
        return null
      }
    },
    async putFile(file: StoredFile): Promise<void> {
      const form = new FormData()
      form.set('meta', JSON.stringify({ name: file.name, pages: file.pages, createdAt: file.createdAt }))
      form.set('source', new Blob([Uint8Array.from(file.source)], { type: 'application/pdf' }), file.name)
      await request(`/files/${file.fileId}`, { method: 'PUT', body: form }, { rejectionMessages: { 413: UPLOAD_TOO_LARGE } })
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
