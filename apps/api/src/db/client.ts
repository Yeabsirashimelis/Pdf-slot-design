import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema } from './schema.js'

/**
 * The database handle every repository takes. Plain TCP Postgres via
 * node-postgres works the same against a local Docker instance and a real
 * Neon endpoint -- no WebSocket proxy needed -- and supports
 * `db.transaction`, which job writes rely on. Tests are PGlite
 * (test/helpers/db.ts) cast to this type, which is safe because
 * repositories use only the query builder surface both drivers share, and
 * PGlite's own drizzle driver supports `transaction` too, so tests exercise
 * the real transaction path.
 */
export type Db = NodePgDatabase<typeof schema>

export function createDb(url: string): Db {
  return drizzle(new Pool({ connectionString: url }), { schema })
}

/** ISO string for a timestamp column. */
export const iso = (d: Date) => d.toISOString()
