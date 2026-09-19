import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import type { Db } from '../../src/db/client.js'
import { schema } from '../../src/db/schema.js'

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url))

/** A fresh in-memory Postgres with the committed migrations applied -- the same SQL production runs. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema })
  await migrate(db, { migrationsFolder })
  return db as unknown as Db
}
