// Apply drizzle/*.sql over HTTPS instead of TCP.
//
// `npm run db:migrate` (drizzle-kit) speaks plain Postgres on port 5432.
// Some networks -- including the one this is usually run from -- drop that
// connection to Neon, and drizzle-kit simply hangs on "applying
// migrations". Neon serves the same SQL over HTTPS, which gets through.
//
// Same files, same folder, same __drizzle_migrations bookkeeping: either
// script leaves the database in the same state, and running one after the
// other is a no-op. Use drizzle-kit where TCP works; use this where it
// does not.
//
// Usage: DATABASE_URL=... node scripts/migrate-http.mjs
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const migrationsFolder = new URL('../drizzle', import.meta.url).pathname
const db = drizzle(neon(url))

await migrate(db, { migrationsFolder })
console.log('migrations applied')

// Print the shape that came out, so a run that did nothing is visible
// rather than assumed.
const columns = await db.$client`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position
`
for (const table of [...new Set(columns.map((c) => c.table_name))]) {
  const of = columns.filter((c) => c.table_name === table)
  console.log(`${table}: ${of.map((c) => `${c.column_name} ${c.data_type}`).join(', ')}`)
}
