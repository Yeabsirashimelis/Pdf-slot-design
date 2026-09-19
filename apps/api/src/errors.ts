import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
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
  // Middleware such as hono/bearer-auth throws this rather than an ApiError; wrap its 401 in our envelope
  // and fall back to its own response (e.g. 400 for a malformed Authorization header) otherwise.
  if (err instanceof HTTPException) {
    if (err.status === 401) return c.json({ error: { code: 'unauthorized', message: 'Invalid or missing API key' } }, err.status)
    return err.getResponse()
  }
  console.error(err)
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
}
