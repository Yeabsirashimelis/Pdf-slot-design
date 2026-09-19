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

const httpExceptionCode = (status: number): string =>
  status === 401 ? 'unauthorized' : status === 400 ? 'invalid_request' : 'http_error'

// hono's own exceptions carry their text in the Response, not in `message` (it is usually empty), so
// the message is ours: the 401 is always the key, and a 400 from bearer-auth is a malformed header.
const httpExceptionMessage = (err: HTTPException): string => {
  if (err.status === 401) return 'Invalid or missing API key'
  if (err.message) return err.message
  return err.status === 400 ? 'Malformed request' : 'Request refused'
}

export function handleError(err: Error, c: Context): Response {
  if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
  // Middleware such as hono/bearer-auth throws this rather than an ApiError (401 for a wrong key, 400 for
  // a malformed Authorization header). Every one of them gets the same envelope: a client must never
  // have to parse a plain-text body to learn why a request was refused.
  if (err instanceof HTTPException) return c.json({ error: { code: httpExceptionCode(err.status), message: httpExceptionMessage(err) } }, err.status)
  console.error(err)
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
}
