import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** A failure the client can act on: carried as `{ error: { code, message } }` with its status. */
export class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`)

export function handleError(err: Error, c: Context): Response {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
  console.error(err)
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
}
