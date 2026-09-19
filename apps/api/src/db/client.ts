import { Pool } from '@neondatabase/serverless'
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import { schema } from './schema.js'

/**
 * The database handle every repository takes. Production is Neon over a
 * pooled WebSocket connection, not the plain HTTP driver -- job writes need
 * `db.transaction`, which `drizzle-orm/neon-http` does not support. Node >=22
 * (this API's runtime) has a global `WebSocket`, so no `ws` package/shim is
 * needed for the driver to work even on Fluid compute's short-lived
 * invocations. Tests are PGlite (test/helpers/db.ts) cast to this type,
 * which is safe because repositories use only the query builder surface
 * both drivers share, and PGlite's own drizzle driver supports
 * `transaction` too, so tests exercise the real transaction path.
 */
export type Db = NeonDatabase<typeof schema>

export function createDb(url: string): Db {
  return drizzle(new Pool({ connectionString: url }), { schema })
}

/** ISO string for a timestamp column. */
export const iso = (d: Date) => d.toISOString()
