import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { schema } from './schema.js'

/**
 * The database handle every repository takes. Production is Neon over HTTP
 * (one request per query -- right for Fluid compute, where there is no
 * long-lived socket to pool); tests are PGlite (test/helpers/db.ts) cast to
 * this type, which is safe because repositories use only the query
 * builder surface both drivers share.
 */
export type Db = NeonHttpDatabase<typeof schema>

export function createDb(url: string): Db {
  return drizzle(neon(url), { schema })
}

/** ISO string for a timestamp column. */
export const iso = (d: Date) => d.toISOString()
