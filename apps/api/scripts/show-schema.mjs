// What columns the database actually has, read over HTTPS. Read-only:
// it runs no migration and writes nothing, so it is safe to point at
// production to see whether a migration has landed.
//
// Usage: DATABASE_URL=... node scripts/show-schema.mjs
//
// On a network where Node's HTTP client cannot reach the database host
// but curl can, use scripts/neon-sql.sh instead -- same endpoint, a
// client that gets through.
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = neon(url)
const columns = await sql`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position
`
for (const table of [...new Set(columns.map((c) => c.table_name))]) {
  const of = columns.filter((c) => c.table_name === table)
  console.log(`${table}: ${of.map((c) => c.column_name).join(', ')}`)
}

const applied = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
console.log(`\nmigrations applied: ${applied.length}`)
