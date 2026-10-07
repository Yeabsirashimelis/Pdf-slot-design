# Backend and Bulk Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hono API (`apps/api`) that stores files, layouts and values in Postgres + Vercel Blob, generates one PDF per record as a background Workflow job, and a web app that uses it when `NEXT_PUBLIC_API_URL` is set — and IndexedDB, unchanged, when it is not.

**Architecture:** Three new units: `packages/contracts` (zod schemas shared by client and server), `apps/api` (Hono on Nitro, Drizzle over Neon Postgres, a `BlobStore` interface over Vercel Blob, Workflow steps that call `@pdf-slot/core`'s `renderPdf`), and in `apps/web` an `HttpTemplateStore` behind the existing `TemplateStore` interface plus a Generate panel. Every server module takes its dependencies (db, blobs, fonts, job starter) as arguments so tests run in-process with PGlite and an in-memory blob store — no Docker, no network.

**Tech Stack:** hono 4.13, @hono/zod-validator, zod 4, drizzle-orm 0.45 (+ drizzle-kit 0.31), @neondatabase/serverless 1.1, @electric-sql/pglite (tests), @vercel/blob 2.8, workflow 4.8 on nitro 3 (beta, as the Workflow Hono guide requires), fflate 0.8, vitest 4. Web: existing Next 16 / shadcn stack (adds shadcn `progress`).

**Spec:** `docs/superpowers/specs/2026-09-19-backend-and-bulk-generation-design.md`

## Global Constraints

- Preview == download == bulk output: bulk uses `renderPdf` from `@pdf-slot/core` with `toSlots(layout, values)`; never a second renderer.
- With `NEXT_PUBLIC_API_URL` unset the web app behaves exactly as today; every existing web test runs on IndexedDB and must stay green (`npm run verify`).
- `TemplateStore` contract: methods never reject; storage failure warns once and degrades.
- All UI via shadcn (install with `npx shadcn@latest add <name>` from `apps/web`); hand-rolled only with a comment.
- Commits: Conventional Commits, author Yeabsirashimelis (repo-local config), **no trailers**.
- Slot names unique per file: enforced in the web name dialog and by the API (409).
- Bulk job: `POST /files/:id/jobs` requires `Authorization: Bearer <API_KEY>`; 1–5000 records; batches of 25; item failures never fail the job; a job with zero rendered items is `failed`.
- Blob objects are private; bytes are served through the API (`/files/:id/source`, `/jobs/:id/zip`), never by public URL.
- Repo-local deps only: `packages/contracts` depends on `@pdf-slot/core` and `zod`; `apps/api` never imports from `apps/web`.

---

## File structure

```
packages/contracts/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                 zod schemas + inferred types (FileMeta, JobStatus, …)
  test/contracts.test.ts

apps/api/
  package.json (exists), tsconfig.json, tsconfig.build.json, vitest.config.ts, nitro.config.ts, drizzle.config.ts
  drizzle/                     generated SQL migrations (committed)
  src/config.ts                readConfig(env) -> Config
  src/errors.ts                ApiError + onError handler
  src/db/schema.ts             Drizzle tables
  src/db/client.ts             createDb(url) (neon-http), Db type
  src/db/files.ts              file repository
  src/db/layouts.ts            layout + values repository
  src/db/jobs.ts               job repository
  src/blob/blobStore.ts        BlobStore interface
  src/blob/memoryBlobStore.ts  in-memory implementation (tests)
  src/blob/vercelBlobStore.ts  @vercel/blob implementation
  src/app.ts                   createApp(deps) -> Hono
  src/routes/files.ts          /files routes
  src/routes/layouts.ts        /files/:id/layout, /files/:id/values
  src/routes/jobs.ts           /files/:id/jobs, /jobs/:id, /jobs/:id/zip
  src/jobs/records.ts          recordToValues, itemFileName
  src/jobs/fonts.ts            loadFonts(fontSource), diskFontSource(dir)
  src/jobs/zip.ts              zipStream(entries)
  src/jobs/context.ts          JobContext get/set (lazy production init)
  src/jobs/steps.ts            loadJob, renderBatch, finishJob  ("use step")
  src/jobs/generateJob.ts      generateJob  ("use workflow")
  src/runtime.ts               production wiring (env -> db, blobs, fonts via nitro assets)
  src/index.ts                 nitro entry: exports the Hono app
  test/helpers/db.ts           PGlite + migrations
  test/helpers/fixtures.ts     two-page PDF, fonts from packages/core
  test/*.test.ts

apps/web/src/lib/persistence/
  httpTemplateStore.ts         TemplateStore over fetch
  index.ts                     store selection (API URL -> http, else IndexedDB)
apps/web/src/features/generate/
  parseRecords.ts              JSON / CSV -> records
  jobsClient.ts                createJob, fetchJob
  useJobPolling.ts
  GeneratePanel.tsx
```

---

### Task 1: `packages/contracts` — shared schemas

**Files:**
- Create: `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`
- Modify: `package.json` (root scripts), `apps/web/tsconfig.json` is untouched (web imports contracts through the workspace symlink like it does core)

**Interfaces:**
- Produces: `fileIdSchema`, `templateSlotSchema`, `templateLayoutSchema`, `templateValuesSchema`, `pageSizeSchema`, `fileMetaSchema` + `type FileMeta = { fileId; name; pages: PageSize[]; createdAt: string }`, `storedFileSummarySchema`, `createJobRequestSchema` + `type CreateJobRequest`, `jobItemStatusSchema`, `jobStatusSchema` + `type JobStatus`, `apiErrorSchema` + `type ApiError`, constants `MAX_JOB_RECORDS = 5000`, `JOB_BATCH_SIZE = 25`.

- [ ] **Step 1: Config files**

`packages/contracts/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "lib": ["ES2022"],
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true, "types": ["node"]
  },
  "include": ["src", "test"]
}
```
`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/test/contracts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  createJobRequestSchema, fileIdSchema, jobStatusSchema, storedFileSummarySchema, templateLayoutSchema,
  MAX_JOB_RECORDS,
} from '../src/index.js'

const slot = {
  id: 's1', name: 'Date', order: 0, page: 0, x: 10, y: 700, width: 200,
  fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
}
const hash = 'a'.repeat(64)

describe('contracts', () => {
  it('a file id is a 64-hex content hash or a 32-hex random id', () => {
    expect(fileIdSchema.safeParse(hash).success).toBe(true)
    expect(fileIdSchema.safeParse('b'.repeat(32)).success).toBe(true)
    expect(fileIdSchema.safeParse('not-an-id').success).toBe(false)
  })

  it('a layout round-trips; height is optional; an unknown font is refused', () => {
    const layout = { fileId: hash, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot, { ...slot, id: 's2', height: 40 }] }
    expect(templateLayoutSchema.parse(layout)).toEqual(layout)
    expect(templateLayoutSchema.safeParse({ ...layout, slots: [{ ...slot, fontId: 'comic' }] }).success).toBe(false)
  })

  it('a job request needs 1..MAX_JOB_RECORDS string records', () => {
    expect(createJobRequestSchema.safeParse({ records: [] }).success).toBe(false)
    expect(createJobRequestSchema.safeParse({ records: [{ Name: 'Abel' }] }).success).toBe(true)
    expect(createJobRequestSchema.safeParse({ records: [{ Name: 3 }] }).success).toBe(false)
    expect(createJobRequestSchema.safeParse({ records: Array(MAX_JOB_RECORDS + 1).fill({ a: 'b' }) }).success).toBe(false)
  })

  it('job status and file summary shapes parse', () => {
    expect(jobStatusSchema.parse({
      id: 'j1', fileId: hash, status: 'running', total: 2, done: 1, failed: 0, error: null,
      createdAt: '2026-09-19T00:00:00.000Z', finishedAt: null,
      items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'pending', error: null }],
    }).status).toBe('running')
    expect(storedFileSummarySchema.parse({ fileId: hash, name: 'a.pdf', pageCount: 2, slotCount: 3, updatedAt: 't' }).slotCount).toBe(3)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/contracts && npx vitest run`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 4: Implement**

`packages/contracts/src/index.ts`:
```ts
import { z } from 'zod'
import type { FileId, PageSize, StoredFile, TemplateLayout, TemplateSlot, TemplateValues } from '@pdf-slot/core'

/** Request/response shapes shared by the API and the web client -- one source of truth, validated on both sides. */

export const MAX_JOB_RECORDS = 5000
export const JOB_BATCH_SIZE = 25

/** 64-hex SHA-256 (content hash) or 32-hex random id (see apps/web fileHash.ts). */
export const fileIdSchema = z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f]{32})$/)

export const fontIdSchema = z.enum(['sans', 'sans-bold', 'serif', 'serif-bold', 'mono'])
export const pageSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() })

export const templateSlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().min(0),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().min(0).optional(),
  fontId: fontIdSchema,
  size: z.number().positive(),
  color: z.object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1) }),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive(),
}) satisfies z.ZodType<TemplateSlot>

export const templateLayoutSchema = z.object({
  fileId: fileIdSchema,
  slots: z.array(templateSlotSchema),
  updatedAt: z.string(),
}) satisfies z.ZodType<TemplateLayout>

export const templateValuesSchema = z.object({
  fileId: fileIdSchema,
  values: z.record(z.string(), z.string()),
  updatedAt: z.string(),
}) satisfies z.ZodType<TemplateValues>

/** `StoredFile` without its bytes: what `GET /files/:id` returns; the bytes come from `/source`. */
export const fileMetaSchema = z.object({
  fileId: fileIdSchema,
  name: z.string().min(1),
  pages: z.array(pageSizeSchema).min(1),
  createdAt: z.string(),
})
export type FileMeta = z.infer<typeof fileMetaSchema>
export type _FileMetaMatchesCore = FileMeta extends Omit<StoredFile, 'source'> ? true : never

/** The multipart `meta` part of `PUT /files/:id` (the id is in the path). */
export const putFileMetaSchema = fileMetaSchema.omit({ fileId: true })

export const storedFileSummarySchema = z.object({
  fileId: fileIdSchema,
  name: z.string(),
  pageCount: z.number().int().min(0),
  slotCount: z.number().int().min(0),
  updatedAt: z.string(),
})
export type StoredFileSummary = z.infer<typeof storedFileSummarySchema>

/** One record per PDF: slot name -> text. Unknown keys are ignored, missing slots are left blank. */
export const jobRecordSchema = z.record(z.string(), z.string())
export type JobRecord = z.infer<typeof jobRecordSchema>

export const createJobRequestSchema = z.object({
  records: z.array(jobRecordSchema).min(1).max(MAX_JOB_RECORDS),
})
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>

export const jobItemStatusSchema = z.enum(['pending', 'done', 'failed'])
export const jobStatusValueSchema = z.enum(['queued', 'running', 'done', 'failed'])

export const jobItemSchema = z.object({
  index: z.number().int().min(0),
  status: jobItemStatusSchema,
  error: z.string().nullable(),
})
export const jobStatusSchema = z.object({
  id: z.string(),
  fileId: fileIdSchema,
  status: jobStatusValueSchema,
  total: z.number().int().min(0),
  done: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  items: z.array(jobItemSchema),
})
export type JobStatus = z.infer<typeof jobStatusSchema>
export type JobItem = z.infer<typeof jobItemSchema>

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export type { FileId }
```

- [ ] **Step 5: Root scripts include the new workspaces**

In root `package.json` replace the `test` and `typecheck` scripts:
```json
"test": "npm test --workspace=@pdf-slot/core && npm test --workspace=@pdf-slot/contracts && npm test --workspace=api && npm test --workspace=web",
"typecheck": "npm run typecheck --workspace=@pdf-slot/core && npm run typecheck --workspace=@pdf-slot/contracts && npm run typecheck --workspace=api && npm run typecheck --workspace=web",
```
(`api` tests/typecheck exist after Task 2; until then the root `test` script fails on the missing workspace script — that is acceptable inside this task's commit because Task 2 immediately follows. Run the workspace-local commands for verification here.)

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/contracts && npx vitest run && npx tsc --noEmit`
Expected: 4 passed; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts package.json package-lock.json apps/api/package.json
git commit -m "feat(contracts): shared request and response schemas for the API"
```

---

### Task 2: `apps/api` skeleton — config, errors, Hono app with health, Nitro entry

**Files:**
- Create: `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/vitest.config.ts`, `apps/api/nitro.config.ts`, `apps/api/src/config.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/.env.example`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/app.test.ts`

**Interfaces:**
- Produces: `readConfig(env: Record<string, string | undefined>): Config` where `Config = { databaseUrl: string; blobToken: string; apiKey: string; webOrigin: string }`; `class ApiError extends Error { constructor(status: number, code: string, message: string) }`; `createApp(deps: Deps): Hono<AppEnv>` where `Deps = { db: Db; blobs: BlobStore; config: Pick<Config, 'apiKey' | 'webOrigin'>; startJob(jobId: string): Promise<void> }` (`Db`, `BlobStore` defined in Tasks 3–4; in this task `Deps` is declared with those imports and the fields are unused). `AppEnv = { Variables: { deps: Deps } }`.

- [ ] **Step 1: Config files**

`apps/api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "lib": ["ES2022", "DOM"],
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true, "types": ["node"],
    "plugins": [{ "name": "workflow" }]
  },
  "include": ["src", "test", "nitro.config.ts", "drizzle.config.ts"]
}
```
`apps/api/tsconfig.build.json`: `{ "extends": "./tsconfig.json", "include": ["src"] }` (used only by `typecheck`; Nitro builds).

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 30_000 },
})
```
`apps/api/nitro.config.ts`:
```ts
import { defineConfig } from 'nitro'

export default defineConfig({
  modules: ['workflow/nitro'],
  routes: { '/**': './src/index.ts' },
  // The five TTFs the renderer embeds, bundled from packages/core so the
  // server never carries a second copy that could drift from the editor's.
  serverAssets: [{ baseName: 'fonts', dir: '../../packages/core/src/fonts/files' }],
})
```
Update `apps/api/package.json` scripts: `"dev": "nitro dev"`, `"build": "nitro build"`, `"typecheck": "tsc -p tsconfig.build.json --noEmit"`, `"lint": "eslint src test"` (add `eslint` + `typescript-eslint` devDeps: `npm i -w api -D eslint typescript-eslint @eslint/js`), and `apps/api/eslint.config.mjs`:
```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, { ignores: ['.nitro/**', '.output/**', 'drizzle/**'] })
```
`apps/api/.env.example`:
```
DATABASE_URL=postgres://...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
API_KEY=change-me
WEB_ORIGIN=http://localhost:3005
```
Add to root `.gitignore`: `.nitro/` and `.output/`.

- [ ] **Step 2: Write the failing tests**

`apps/api/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'

const full = { DATABASE_URL: 'postgres://x', BLOB_READ_WRITE_TOKEN: 't', API_KEY: 'k', WEB_ORIGIN: 'http://localhost:3005' }

describe('readConfig', () => {
  it('reads the four variables', () => {
    expect(readConfig(full)).toEqual({ databaseUrl: 'postgres://x', blobToken: 't', apiKey: 'k', webOrigin: 'http://localhost:3005' })
  })
  it('names every missing variable in one error', () => {
    expect(() => readConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/BLOB_READ_WRITE_TOKEN, API_KEY, WEB_ORIGIN/)
  })
})
```
`apps/api/test/app.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'

describe('app', () => {
  it('answers health and CORS for the web origin', async () => {
    const app = createApp(await testDeps())
    const res = await app.request('/health', { headers: { Origin: 'http://web.test' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://web.test')
  })
  it('unknown routes are a JSON 404 in the error envelope', async () => {
    const app = createApp(await testDeps())
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})
```
`apps/api/test/helpers/deps.ts` (Tasks 3–4 fill `db`/`blobs`; write it now with the final shape so it needs no later edit):
```ts
import type { Deps } from '../../src/app.js'
import { createTestDb } from './db.js'
import { createMemoryBlobStore } from '../../src/blob/memoryBlobStore.js'

export async function testDeps(over: Partial<Deps> = {}): Promise<Deps> {
  return {
    db: await createTestDb(),
    blobs: createMemoryBlobStore(),
    config: { apiKey: 'test-key', webOrigin: 'http://web.test' },
    startJob: async () => {},
    ...over,
  }
}
```
Until Tasks 3–4 exist, create minimal placeholders that this task replaces: `test/helpers/db.ts` exporting `export async function createTestDb() { return {} as never }` and `src/blob/memoryBlobStore.ts` exporting `export function createMemoryBlobStore() { return {} as never }`. Tasks 3 and 4 overwrite both files.

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/api && npx vitest run`
Expected: FAIL — `../src/config.js` / `../src/app.js` not found.

- [ ] **Step 4: Implement**

`apps/api/src/config.ts`:
```ts
export type Config = { databaseUrl: string; blobToken: string; apiKey: string; webOrigin: string }

const VARS = { databaseUrl: 'DATABASE_URL', blobToken: 'BLOB_READ_WRITE_TOKEN', apiKey: 'API_KEY', webOrigin: 'WEB_ORIGIN' } as const

/** Reads the environment once at startup; a missing variable is a startup error, not a runtime surprise. */
export function readConfig(env: Record<string, string | undefined>): Config {
  const missing = Object.values(VARS).filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  return {
    databaseUrl: env.DATABASE_URL!,
    blobToken: env.BLOB_READ_WRITE_TOKEN!,
    apiKey: env.API_KEY!,
    webOrigin: env.WEB_ORIGIN!,
  }
}
```
`apps/api/src/errors.ts`:
```ts
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
```
`apps/api/src/app.ts`:
```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Db } from './db/client.js'
import type { BlobStore } from './blob/blobStore.js'
import type { Config } from './config.js'
import { handleError } from './errors.js'
import { filesRoutes } from './routes/files.js'
import { layoutsRoutes } from './routes/layouts.js'
import { jobsRoutes } from './routes/jobs.js'

/** Everything a request handler needs, injected so tests run the app in-process against PGlite and an in-memory blob store. */
export type Deps = {
  db: Db
  blobs: BlobStore
  config: Pick<Config, 'apiKey' | 'webOrigin'>
  /** Starts the generation workflow for a job that has been inserted. */
  startJob(jobId: string): Promise<void>
}
export type AppEnv = { Variables: { deps: Deps } }

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use('*', cors({ origin: deps.config.webOrigin }))
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.get('/health', (c) => c.json({ ok: true }))
  app.route('/', filesRoutes)
  app.route('/', layoutsRoutes)
  app.route('/', jobsRoutes)
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
  app.onError(handleError)
  return app
}
```
For this task, create the three route modules as empty routers so the app compiles; Tasks 5–7 fill them:
```ts
// src/routes/files.ts (same shape for layouts.ts -> layoutsRoutes, jobs.ts -> jobsRoutes)
import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
export const filesRoutes = new Hono<AppEnv>()
```
Also create type-only placeholders that Tasks 3–4 replace: `src/db/client.ts` with `export type Db = unknown` and `src/blob/blobStore.ts` with `export type BlobStore = unknown`.

`apps/api/src/index.ts` (Nitro entry; not imported by tests):
```ts
import { createApp } from './app.js'
import { productionDeps } from './runtime.js'

export default createApp(await productionDeps())
```
`apps/api/src/runtime.ts` — written fully in Task 9; for now:
```ts
import type { Deps } from './app.js'
export async function productionDeps(): Promise<Deps> {
  throw new Error('wired in Task 9')
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `cd apps/api && npx vitest run && npm run typecheck && npm run lint`
Expected: 4 passed; clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api .gitignore package-lock.json
git commit -m "feat(api): Hono app skeleton with config, error envelope, CORS and health"
```

---

### Task 3: Database — schema, migration, client, PGlite test helper, file/layout/values repositories

**Files:**
- Create: `apps/api/drizzle.config.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/files.ts`, `apps/api/src/db/layouts.ts`, `apps/api/drizzle/0000_*.sql` (generated), `apps/api/test/helpers/db.ts`
- Test: `apps/api/test/db.files.test.ts`, `apps/api/test/db.layouts.test.ts`

**Interfaces:**
- Produces: `type Db` (drizzle database over `schema`); `createDb(url: string): Db`; `createTestDb(): Promise<Db>` (fresh PGlite with migrations applied); repositories:
  - `listFiles(db): Promise<StoredFileSummary[]>`
  - `getFileMeta(db, fileId): Promise<FileRow | null>` with `FileRow = FileMeta & { blobPath: string }`
  - `upsertFile(db, row: FileRow): Promise<void>`
  - `deleteFile(db, fileId): Promise<FileRow | null>` (returns what was deleted so blobs can be removed)
  - `getLayout(db, fileId): Promise<TemplateLayout | null>`, `putLayout(db, layout): Promise<void>`
  - `getValues(db, fileId): Promise<TemplateValues | null>`, `putValues(db, values): Promise<void>`
  - `hasDuplicateSlotNames(slots: { name: string }[]): string | null` (the first duplicated name, or null)

- [ ] **Step 1: Write the failing tests**

`apps/api/test/db.files.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { deleteFile, getFileMeta, listFiles, upsertFile } from '../src/db/files.js'
import { putLayout } from '../src/db/layouts.js'

const id = (c: string) => c.repeat(64)
const row = (fileId: string, name: string, createdAt: string) => ({
  fileId, name, pages: [{ width: 612, height: 792 }], blobPath: `files/${fileId}.pdf`, createdAt,
})

describe('files repository', () => {
  it('upserts, reads back, and lists newest first with the slot count', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    await upsertFile(db, row(id('b'), 'b.pdf', '2026-09-02T00:00:00.000Z'))
    await putLayout(db, { fileId: id('a'), updatedAt: '2026-09-03T00:00:00.000Z', slots: [
      { id: 's1', name: 'Date', order: 0, page: 0, x: 1, y: 2, width: 3, fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    ] })
    expect(await getFileMeta(db, id('a'))).toEqual(row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    expect(await listFiles(db)).toEqual([
      { fileId: id('a'), name: 'a.pdf', pageCount: 1, slotCount: 1, updatedAt: '2026-09-03T00:00:00.000Z' },
      { fileId: id('b'), name: 'b.pdf', pageCount: 1, slotCount: 0, updatedAt: '2026-09-02T00:00:00.000Z' },
    ])
  })
  it('upsert of the same id keeps one row and updates the name', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    await upsertFile(db, row(id('a'), 'renamed.pdf', '2026-09-01T00:00:00.000Z'))
    expect((await listFiles(db)).map((f) => f.name)).toEqual(['renamed.pdf'])
  })
  it('delete returns the row and cascades the layout; unknown id returns null', async () => {
    const db = await createTestDb()
    await upsertFile(db, row(id('a'), 'a.pdf', '2026-09-01T00:00:00.000Z'))
    expect((await deleteFile(db, id('a')))?.blobPath).toBe(`files/${id('a')}.pdf`)
    expect(await getFileMeta(db, id('a'))).toBeNull()
    expect(await deleteFile(db, id('a'))).toBeNull()
  })
})
```
`apps/api/test/db.layouts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { upsertFile } from '../src/db/files.js'
import { getLayout, getValues, hasDuplicateSlotNames, putLayout, putValues } from '../src/db/layouts.js'

const fileId = 'c'.repeat(64)
const slot = { id: 's1', name: 'Date', order: 0, page: 0, x: 1, y: 2, width: 3, fontId: 'sans' as const, size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left' as const, lineHeight: 1.2 }

describe('layouts and values', () => {
  it('round-trip and overwrite', async () => {
    const db = await createTestDb()
    await upsertFile(db, { fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], blobPath: 'p', createdAt: 't' })
    expect(await getLayout(db, fileId)).toBeNull()
    const layout = { fileId, updatedAt: 't1', slots: [slot] }
    await putLayout(db, layout)
    await putLayout(db, { ...layout, updatedAt: 't2' })
    expect(await getLayout(db, fileId)).toEqual({ ...layout, updatedAt: 't2' })
    const values = { fileId, updatedAt: 'v1', values: { s1: 'hello' } }
    await putValues(db, values)
    expect(await getValues(db, fileId)).toEqual(values)
  })
  it('hasDuplicateSlotNames finds the first repeated name', () => {
    expect(hasDuplicateSlotNames([{ name: 'A' }, { name: 'B' }])).toBeNull()
    expect(hasDuplicateSlotNames([{ name: 'A' }, { name: 'B' }, { name: 'A' }])).toBe('A')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && npx vitest run test/db.files.test.ts test/db.layouts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Schema, client, config**

`apps/api/src/db/schema.ts`:
```ts
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { PageSize, TemplateSlot } from '@pdf-slot/core'
import type { JobRecord } from '@pdf-slot/contracts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}

export const files = pgTable('files', {
  fileId: text('file_id').primaryKey(),
  name: text('name').notNull(),
  pages: jsonb('pages').$type<PageSize[]>().notNull(),
  /** Pathname in the blob store; bytes are never stored in Postgres. */
  blobPath: text('blob_path').notNull(),
  ...timestamps,
})

export const layouts = pgTable('layouts', {
  fileId: text('file_id').primaryKey().references(() => files.fileId, { onDelete: 'cascade' }),
  slots: jsonb('slots').$type<TemplateSlot[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const values = pgTable('values', {
  fileId: text('file_id').primaryKey().references(() => files.fileId, { onDelete: 'cascade' }),
  values: jsonb('values').$type<Record<string, string>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull().references(() => files.fileId, { onDelete: 'cascade' }),
  status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull(),
  total: integer('total').notNull(),
  done: integer('done').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  error: text('error'),
  zipPath: text('zip_path'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ...timestamps,
})

export const jobItems = pgTable('job_items', {
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  record: jsonb('record').$type<JobRecord>().notNull(),
  status: text('status').$type<'pending' | 'done' | 'failed'>().notNull().default('pending'),
  pdfPath: text('pdf_path'),
  error: text('error'),
}, (t) => [primaryKey({ columns: [t.jobId, t.index] })])

export const schema = { files, layouts, values, jobs, jobItems }
```
`apps/api/src/db/client.ts`:
```ts
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
```
`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
```
Generate the migration: `cd apps/api && npx drizzle-kit generate --name init` → commits `drizzle/0000_init.sql` + `drizzle/meta/`.

`apps/api/test/helpers/db.ts`:
```ts
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
```

- [ ] **Step 4: Repositories**

`apps/api/src/db/files.ts`:
```ts
import { desc, eq, sql } from 'drizzle-orm'
import type { FileMeta, StoredFileSummary } from '@pdf-slot/contracts'
import { iso, type Db } from './client.js'
import { files, layouts } from './schema.js'

export type FileRow = FileMeta & { blobPath: string }

const toRow = (r: typeof files.$inferSelect): FileRow => ({
  fileId: r.fileId, name: r.name, pages: r.pages, blobPath: r.blobPath, createdAt: iso(r.createdAt),
})

export async function getFileMeta(db: Db, fileId: string): Promise<FileRow | null> {
  const [r] = await db.select().from(files).where(eq(files.fileId, fileId)).limit(1)
  return r ? toRow(r) : null
}

export async function upsertFile(db: Db, row: FileRow): Promise<void> {
  const insert = { fileId: row.fileId, name: row.name, pages: row.pages, blobPath: row.blobPath, createdAt: new Date(row.createdAt) }
  await db.insert(files).values(insert).onConflictDoUpdate({ target: files.fileId, set: { name: insert.name, pages: insert.pages, blobPath: insert.blobPath } })
}

export async function deleteFile(db: Db, fileId: string): Promise<FileRow | null> {
  const [r] = await db.delete(files).where(eq(files.fileId, fileId)).returning()
  return r ? toRow(r) : null
}

/** Newest first, by the layout's last save or the file's creation. */
export async function listFiles(db: Db): Promise<StoredFileSummary[]> {
  const updatedAt = sql<Date>`coalesce(${layouts.updatedAt}, ${files.createdAt})`
  const rows = await db
    .select({
      fileId: files.fileId, name: files.name, pages: files.pages,
      slotCount: sql<number>`coalesce(jsonb_array_length(${layouts.slots}), 0)`.mapWith(Number),
      updatedAt,
    })
    .from(files)
    .leftJoin(layouts, eq(layouts.fileId, files.fileId))
    .orderBy(desc(updatedAt))
  return rows.map((r) => ({ fileId: r.fileId, name: r.name, pageCount: r.pages.length, slotCount: r.slotCount, updatedAt: iso(new Date(r.updatedAt)) }))
}
```
`apps/api/src/db/layouts.ts`:
```ts
import { eq } from 'drizzle-orm'
import type { TemplateLayout, TemplateValues } from '@pdf-slot/core'
import { iso, type Db } from './client.js'
import { layouts, values } from './schema.js'

export async function getLayout(db: Db, fileId: string): Promise<TemplateLayout | null> {
  const [r] = await db.select().from(layouts).where(eq(layouts.fileId, fileId)).limit(1)
  return r ? { fileId: r.fileId, slots: r.slots, updatedAt: iso(r.updatedAt) } : null
}

export async function putLayout(db: Db, layout: TemplateLayout): Promise<void> {
  const row = { fileId: layout.fileId, slots: layout.slots, updatedAt: new Date(layout.updatedAt) }
  await db.insert(layouts).values(row).onConflictDoUpdate({ target: layouts.fileId, set: { slots: row.slots, updatedAt: row.updatedAt } })
}

export async function getValues(db: Db, fileId: string): Promise<TemplateValues | null> {
  const [r] = await db.select().from(values).where(eq(values.fileId, fileId)).limit(1)
  return r ? { fileId: r.fileId, values: r.values, updatedAt: iso(r.updatedAt) } : null
}

export async function putValues(db: Db, v: TemplateValues): Promise<void> {
  const row = { fileId: v.fileId, values: v.values, updatedAt: new Date(v.updatedAt) }
  await db.insert(values).values(row).onConflictDoUpdate({ target: values.fileId, set: { values: row.values, updatedAt: row.updatedAt } })
}

/** Slot names are a record's keys in bulk generation, so a file cannot have two slots with one name. */
export function hasDuplicateSlotNames(slots: { name: string }[]): string | null {
  const seen = new Set<string>()
  for (const { name } of slots) {
    if (seen.has(name)) return name
    seen.add(name)
  }
  return null
}
```

- [ ] **Step 5: Run tests, typecheck**

Run: `cd apps/api && npx vitest run && npm run typecheck`
Expected: all pass. If `listFiles`' `updatedAt` comes back as a string under PGlite, wrap with `new Date(...)` as shown (already done) — keep the ISO output asserted by the test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db apps/api/drizzle apps/api/drizzle.config.ts apps/api/test/helpers/db.ts apps/api/test/db.files.test.ts apps/api/test/db.layouts.test.ts
git commit -m "feat(api): Postgres schema, migration and file/layout/values repositories"
```

---

### Task 4: Blob store — interface, in-memory and Vercel implementations

**Files:**
- Create: `apps/api/src/blob/blobStore.ts`, `apps/api/src/blob/memoryBlobStore.ts`, `apps/api/src/blob/vercelBlobStore.ts`
- Test: `apps/api/test/memoryBlobStore.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BlobStore {
  put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string): Promise<void>
  /** null when the path does not exist. */
  get(path: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null>
  delete(paths: string[]): Promise<void>
}
export function createMemoryBlobStore(): BlobStore & { paths(): string[] }
export function createVercelBlobStore(token: string): BlobStore
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array>
```

- [ ] **Step 1: Write the failing test**

`apps/api/test/memoryBlobStore.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createMemoryBlobStore } from '../src/blob/memoryBlobStore.js'
import { readAll } from '../src/blob/blobStore.js'

describe('memory blob store', () => {
  it('stores bytes and streams, reads them back with the content type, deletes', async () => {
    const blobs = createMemoryBlobStore()
    await blobs.put('a.pdf', new Uint8Array([1, 2, 3]), 'application/pdf')
    await blobs.put('b.zip', new ReadableStream({ start(c) { c.enqueue(new Uint8Array([9])); c.close() } }), 'application/zip')
    const a = await blobs.get('a.pdf')
    expect(a?.contentType).toBe('application/pdf')
    expect(Array.from(await readAll(a!.stream))).toEqual([1, 2, 3])
    expect(Array.from(await readAll((await blobs.get('b.zip'))!.stream))).toEqual([9])
    expect(blobs.paths().sort()).toEqual(['a.pdf', 'b.zip'])
    await blobs.delete(['a.pdf', 'missing'])
    expect(await blobs.get('a.pdf')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/memoryBlobStore.test.ts` — FAIL (placeholder returns `{}`; `put` is not a function).

- [ ] **Step 3: Implement**

`apps/api/src/blob/blobStore.ts`:
```ts
/**
 * Where bytes live: source PDFs, generated PDFs, zips. Private objects,
 * addressed by pathname, served only through the API. Vercel Blob in
 * production; an in-memory map in tests.
 */
export interface BlobStore {
  put(path: string, body: Uint8Array | ReadableStream<Uint8Array>, contentType: string): Promise<void>
  get(path: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null>
  delete(paths: string[]): Promise<void>
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

export const bytesToStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
```
`apps/api/src/blob/memoryBlobStore.ts`:
```ts
import { bytesToStream, readAll, type BlobStore } from './blobStore.js'

export function createMemoryBlobStore(): BlobStore & { paths(): string[] } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  return {
    async put(path, body, contentType) {
      objects.set(path, { bytes: body instanceof Uint8Array ? body : await readAll(body), contentType })
    },
    async get(path) {
      const o = objects.get(path)
      return o ? { stream: bytesToStream(o.bytes), contentType: o.contentType } : null
    },
    async delete(paths) {
      for (const p of paths) objects.delete(p)
    },
    paths: () => Array.from(objects.keys()),
  }
}
```
`apps/api/src/blob/vercelBlobStore.ts`:
```ts
import { del, get, put } from '@vercel/blob'
import type { BlobStore } from './blobStore.js'

export function createVercelBlobStore(token: string): BlobStore {
  return {
    async put(path, body, contentType) {
      await put(path, body, { access: 'private', contentType, addRandomSuffix: false, token })
    },
    async get(path) {
      const result = await get(path, { access: 'private', token })
      if (!result) return null
      return { stream: result.stream, contentType: result.headers.get('content-type') ?? 'application/octet-stream' }
    },
    async delete(paths) {
      if (paths.length > 0) await del(paths, { token })
    },
  }
}
```
(If `result.headers` is not a `Headers` in this SDK version, read `result.blob.contentType` instead — check `node_modules/@vercel/blob/dist/index.d.ts` `GetBlobResult`.)

Also `apps/api/src/blob/diskBlobStore.ts` for local development and e2e runs without a Vercel Blob token -- objects under `dir/<path>` with a sidecar `<path>.type` holding the content type:
```ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bytesToStream, readAll, type BlobStore } from './blobStore.js'

export function createDiskBlobStore(dir: string): BlobStore {
  const file = (p: string) => path.join(dir, p)
  return {
    async put(p, body, contentType) {
      await mkdir(path.dirname(file(p)), { recursive: true })
      await writeFile(file(p), body instanceof Uint8Array ? body : await readAll(body))
      await writeFile(file(p) + '.type', contentType)
    },
    async get(p) {
      try {
        const [bytes, contentType] = await Promise.all([readFile(file(p)), readFile(file(p) + '.type', 'utf8')])
        return { stream: bytesToStream(new Uint8Array(bytes)), contentType }
      } catch { return null }
    },
    async delete(paths) {
      await Promise.all(paths.flatMap((p) => [rm(file(p), { force: true }), rm(file(p) + '.type', { force: true })]))
    },
  }
}
```
Test it with the same cases as the memory store (`test/diskBlobStore.test.ts`, using a temp dir from `node:os`/`mkdtemp`). Config (Task 2) gains an optional `BLOB_DIR`: when set, `blobToken` may be empty and runtime.ts (Task 9) picks the disk store.

- [ ] **Step 4: Run tests + typecheck** — `cd apps/api && npx vitest run && npm run typecheck` → pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/blob apps/api/test/memoryBlobStore.test.ts apps/api/test/diskBlobStore.test.ts
git commit -m "feat(api): blob store interface with in-memory, disk and Vercel Blob implementations"
```

---

### Task 5: Files routes

**Files:**
- Modify: `apps/api/src/routes/files.ts`
- Create: `apps/api/test/helpers/fixtures.ts`
- Test: `apps/api/test/routes.files.test.ts`

**Interfaces:**
- Consumes: repositories (Task 3), `BlobStore` (Task 4), `ApiError`/`notFound`.
- Produces: `GET /files`, `GET /files/:id`, `GET /files/:id/source`, `PUT /files/:id` (multipart `meta` json + `source` pdf), `DELETE /files/:id`. Blob path convention `files/<fileId>.pdf` via `sourcePath(fileId)` exported from `routes/files.ts`. Fixture helpers: `twoPagePdf(): Promise<Uint8Array>`, `coreFonts(): FontBytes`, `putTestFile(app, fileId, bytes?)`.

- [ ] **Step 1: Fixtures**

`apps/api/test/helpers/fixtures.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'
import type { Hono } from 'hono'
import type { AppEnv } from '../../src/app.js'

export const fontsDir = fileURLToPath(new URL('../../../../packages/core/src/fonts/files/', import.meta.url))

export function coreFonts(): FontBytes {
  return Object.fromEntries(FONT_IDS.map((id) => [id, new Uint8Array(readFileSync(fontsDir + FONT_FILES[id]))])) as FontBytes
}

export async function twoPagePdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (const t of ['Page one', 'Page two']) d.addPage([612, 792]).drawText(t, { x: 60, y: 720, size: 24, font: f })
  return d.save()
}

export const FILE_ID = 'f'.repeat(64)
export const slot = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Name', order: 0, page: 0, x: 50, y: 700, width: 300,
  fontId: 'sans', size: 14, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2, ...over,
})

export async function putTestFile(app: Hono<AppEnv>, fileId = FILE_ID, bytes?: Uint8Array) {
  const form = new FormData()
  form.set('meta', JSON.stringify({ name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], createdAt: '2026-09-19T00:00:00.000Z' }))
  form.set('source', new Blob([bytes ?? (await twoPagePdf())], { type: 'application/pdf' }), 'form.pdf')
  return app.request(`/files/${fileId}`, { method: 'PUT', body: form })
}
```
Add `@cantoo/pdf-lib` to `apps/api` devDependencies (already a dependency of core; declare it explicitly: `npm i -w api -D @cantoo/pdf-lib@2.9.1`).

- [ ] **Step 2: Write the failing test**

`apps/api/test/routes.files.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, twoPagePdf } from './helpers/fixtures.js'

describe('/files', () => {
  it('PUT stores meta and bytes; GET returns meta; /source streams the same bytes', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    const bytes = await twoPagePdf()
    expect((await putTestFile(app, FILE_ID, bytes)).status).toBe(204)
    const meta = await (await app.request(`/files/${FILE_ID}`)).json()
    expect(meta).toEqual({ fileId: FILE_ID, name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], createdAt: '2026-09-19T00:00:00.000Z' })
    const src = await app.request(`/files/${FILE_ID}/source`)
    expect(src.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await src.arrayBuffer())).toEqual(bytes)
    expect((await (await app.request('/files')).json())[0]).toMatchObject({ fileId: FILE_ID, pageCount: 2, slotCount: 0 })
  })
  it('validates the id and the meta', async () => {
    const app = createApp(await testDeps())
    expect((await app.request('/files/not-an-id')).status).toBe(400)
    const form = new FormData()
    form.set('meta', JSON.stringify({ name: '' }))
    form.set('source', new Blob([1, 2, 3].map((n) => new Uint8Array([n]))), 'x.pdf')
    const res = await app.request(`/files/${FILE_ID}`, { method: 'PUT', body: form })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_request')
  })
  it('404 for unknown files; DELETE removes row and blob', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    expect((await app.request(`/files/${FILE_ID}`)).status).toBe(404)
    expect((await app.request(`/files/${FILE_ID}/source`)).status).toBe(404)
    await putTestFile(app)
    expect((await app.request(`/files/${FILE_ID}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/files/${FILE_ID}`)).status).toBe(404)
    expect((deps.blobs as ReturnType<typeof import('../src/blob/memoryBlobStore.js').createMemoryBlobStore>).paths()).toEqual([])
    expect((await app.request(`/files/${FILE_ID}`, { method: 'DELETE' })).status).toBe(404)
  })
})
```

- [ ] **Step 3: Run to verify it fails** — `cd apps/api && npx vitest run test/routes.files.test.ts` → FAIL (404s where 204/200 expected).

- [ ] **Step 4: Implement**

`apps/api/src/routes/files.ts`:
```ts
import { Hono } from 'hono'
import { fileIdSchema, fileMetaSchema, putFileMetaSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { deleteFile, getFileMeta, listFiles, upsertFile } from '../db/files.js'
import { deleteJobBlobsForFile } from '../db/jobs.js'

export const sourcePath = (fileId: string) => `files/${fileId}.pdf`

/** Path param -> validated file id, or 400. */
export function fileIdParam(raw: string): string {
  const parsed = fileIdSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Invalid file id')
  return parsed.data
}

export const filesRoutes = new Hono<AppEnv>()

filesRoutes.get('/files', async (c) => c.json(await listFiles(c.get('deps').db)))

filesRoutes.get('/files/:id', async (c) => {
  const row = await getFileMeta(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!row) throw notFound('File')
  return c.json(fileMetaSchema.parse(row))
})

filesRoutes.get('/files/:id/source', async (c) => {
  const { db, blobs } = c.get('deps')
  const row = await getFileMeta(db, fileIdParam(c.req.param('id')))
  if (!row) throw notFound('File')
  const object = await blobs.get(row.blobPath)
  if (!object) throw notFound('File bytes')
  return c.body(object.stream, 200, { 'Content-Type': 'application/pdf' })
})

filesRoutes.put('/files/:id', async (c) => {
  const { db, blobs } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const body = await c.req.parseBody()
  const metaRaw = typeof body.meta === 'string' ? body.meta : ''
  let metaJson: unknown
  try { metaJson = JSON.parse(metaRaw) } catch { throw new ApiError(400, 'invalid_request', 'meta must be JSON') }
  const meta = putFileMetaSchema.safeParse(metaJson)
  if (!meta.success) throw new ApiError(400, 'invalid_request', 'Invalid file meta')
  const source = body.source
  if (!(source instanceof File)) throw new ApiError(400, 'invalid_request', 'source must be a file')
  const path = sourcePath(fileId)
  await blobs.put(path, new Uint8Array(await source.arrayBuffer()), 'application/pdf')
  await upsertFile(db, { fileId, ...meta.data, blobPath: path })
  return c.body(null, 204)
})

filesRoutes.delete('/files/:id', async (c) => {
  const { db, blobs } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  // Job output blobs first (the rows cascade with the file), then the file's own bytes.
  const jobPaths = await deleteJobBlobsForFile(db, fileId)
  const row = await deleteFile(db, fileId)
  if (!row) throw notFound('File')
  await blobs.delete([...jobPaths, row.blobPath])
  return c.body(null, 204)
})
```
`deleteJobBlobsForFile` lives in Task 7's `db/jobs.ts`. For this task create `apps/api/src/db/jobs.ts` with just:
```ts
import { eq } from 'drizzle-orm'
import type { Db } from './client.js'
import { jobItems, jobs } from './schema.js'

/** Every blob path a file's jobs produced -- so deleting the file can delete them too. Rows themselves cascade. */
export async function deleteJobBlobsForFile(db: Db, fileId: string): Promise<string[]> {
  const rows = await db.select({ zipPath: jobs.zipPath, pdfPath: jobItems.pdfPath }).from(jobs)
    .leftJoin(jobItems, eq(jobItems.jobId, jobs.id)).where(eq(jobs.fileId, fileId))
  const paths = new Set<string>()
  for (const r of rows) { if (r.zipPath) paths.add(r.zipPath); if (r.pdfPath) paths.add(r.pdfPath) }
  return Array.from(paths)
}
```

- [ ] **Step 5: Run tests + typecheck** → pass. (If `File` is not global under vitest's Node, it is on Node ≥ 20 — the repo requires ≥ 22.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/files.ts apps/api/src/db/jobs.ts apps/api/test/helpers/fixtures.ts apps/api/test/routes.files.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): file routes -- upload, meta, bytes, list, delete"
```

---

### Task 6: Layout and values routes (unique names → 409)

**Files:**
- Modify: `apps/api/src/routes/layouts.ts`
- Test: `apps/api/test/routes.layouts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, slot } from './helpers/fixtures.js'

const json = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('/files/:id/layout and /values', () => {
  it('404 before the file exists and before a layout is saved; round-trips afterwards', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/layout`)).status).toBe(404)
    await putTestFile(app)
    expect((await app.request(`/files/${FILE_ID}/layout`)).status).toBe(404)
    const layout = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:00.000Z', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1 })] }
    expect((await app.request(`/files/${FILE_ID}/layout`, json(layout))).status).toBe(204)
    expect(await (await app.request(`/files/${FILE_ID}/layout`)).json()).toEqual(layout)
    const values = { fileId: FILE_ID, updatedAt: '2026-09-19T00:00:01.000Z', values: { s1: 'Abel' } }
    expect((await app.request(`/files/${FILE_ID}/values`, json(values))).status).toBe(204)
    expect(await (await app.request(`/files/${FILE_ID}/values`)).json()).toEqual(values)
  })
  it('refuses a layout with two slots of one name (409) and a body whose fileId disagrees with the path (400)', async () => {
    const app = createApp(await testDeps())
    await putTestFile(app)
    const dup = { fileId: FILE_ID, updatedAt: 't', slots: [slot(), slot({ id: 's2' })] }
    const res = await app.request(`/files/${FILE_ID}/layout`, json(dup))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toEqual({ code: 'duplicate_slot_name', message: 'Two slots are named "Name"' })
    expect((await app.request(`/files/${FILE_ID}/layout`, json({ ...dup, slots: [slot()], fileId: 'a'.repeat(64) }))).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/routes/layouts.ts`:
```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { templateLayoutSchema, templateValuesSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { getFileMeta } from '../db/files.js'
import { getLayout, getValues, hasDuplicateSlotNames, putLayout, putValues } from '../db/layouts.js'
import { fileIdParam } from './files.js'

const invalid = () => new ApiError(400, 'invalid_request', 'Invalid body')
const validate = <T extends typeof templateLayoutSchema | typeof templateValuesSchema>(schema: T) =>
  zValidator('json', schema, (result) => { if (!result.success) throw invalid() })

export const layoutsRoutes = new Hono<AppEnv>()

layoutsRoutes.get('/files/:id/layout', async (c) => {
  const layout = await getLayout(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!layout) throw notFound('Layout')
  return c.json(layout)
})

layoutsRoutes.put('/files/:id/layout', validate(templateLayoutSchema), async (c) => {
  const { db } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const layout = c.req.valid('json')
  if (layout.fileId !== fileId) throw invalid()
  if (!(await getFileMeta(db, fileId))) throw notFound('File')
  const dup = hasDuplicateSlotNames(layout.slots)
  if (dup !== null) throw new ApiError(409, 'duplicate_slot_name', `Two slots are named "${dup}"`)
  await putLayout(db, layout)
  return c.body(null, 204)
})

layoutsRoutes.get('/files/:id/values', async (c) => {
  const values = await getValues(c.get('deps').db, fileIdParam(c.req.param('id')))
  if (!values) throw notFound('Values')
  return c.json(values)
})

layoutsRoutes.put('/files/:id/values', validate(templateValuesSchema), async (c) => {
  const { db } = c.get('deps')
  const fileId = fileIdParam(c.req.param('id'))
  const values = c.req.valid('json')
  if (values.fileId !== fileId) throw invalid()
  if (!(await getFileMeta(db, fileId))) throw notFound('File')
  await putValues(db, values)
  return c.body(null, 204)
})
```

- [ ] **Step 4: Run tests + typecheck** → pass.
- [ ] **Step 5: Commit** — `git add apps/api/src/routes/layouts.ts apps/api/test/routes.layouts.test.ts && git commit -m "feat(api): layout and values routes; duplicate slot names are refused"`

---

### Task 7: Jobs — repository, records mapping, routes (create with API key, status, zip)

**Files:**
- Modify: `apps/api/src/db/jobs.ts`, `apps/api/src/routes/jobs.ts`
- Create: `apps/api/src/jobs/records.ts`
- Test: `apps/api/test/db.jobs.test.ts`, `apps/api/test/records.test.ts`, `apps/api/test/routes.jobs.test.ts`

**Interfaces:**
- Produces (repository): `createJob(db, { id, fileId, records }): Promise<void>`; `getJob(db, id): Promise<JobStatus | null>`; `getJobItems(db, jobId, indices): Promise<{ index; record }[]>`; `markItem(db, jobId, index, result: { status: 'done'; pdfPath: string } | { status: 'failed'; error: string }): Promise<void>` (also increments `jobs.done` / `jobs.failed`); `setJobStatus(db, id, patch: { status; error?: string | null; zipPath?: string | null; finishedAt?: Date | null })`; `getJobRow(db, id): Promise<{ id; fileId; status; total; zipPath } | null>`; `listDoneItemPaths(db, jobId): Promise<{ index: number; pdfPath: string }[]>`; `deleteJobBlobsForFile` (Task 5).
- Produces (records): `recordToValues(layout: TemplateLayout, record: JobRecord): Record<string, string>` (slot id → text, by slot name; missing → omitted; unknown keys ignored); `itemFileName(index: number): string` → `record-0001.pdf`; `zipPath(jobId)`, `itemPath(jobId, index)`.
- Produces (routes): `POST /files/:id/jobs` (bearer), `GET /jobs/:id`, `GET /jobs/:id/zip`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/records.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { itemFileName, recordToValues } from '../src/jobs/records.js'
import { FILE_ID, slot } from './helpers/fixtures.js'

const layout = { fileId: FILE_ID, updatedAt: 't', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1 })] } as never

describe('records', () => {
  it('maps slot names to slot ids; missing names are blank; unknown keys are ignored', () => {
    expect(recordToValues(layout, { Name: 'Abel', Extra: 'x' })).toEqual({ s1: 'Abel' })
    expect(recordToValues(layout, { Name: 'Abel', Date: '18 Sep' })).toEqual({ s1: 'Abel', s2: '18 Sep' })
  })
  it('names files by 1-based, zero-padded index', () => {
    expect(itemFileName(0)).toBe('record-0001.pdf')
    expect(itemFileName(1234)).toBe('record-1235.pdf')
  })
})
```
`apps/api/test/db.jobs.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import { upsertFile } from '../src/db/files.js'
import { createJob, getJob, getJobItems, listDoneItemPaths, markItem, setJobStatus } from '../src/db/jobs.js'
import { FILE_ID } from './helpers/fixtures.js'

describe('jobs repository', () => {
  it('creates a queued job with pending items, marks items and counts, finishes', async () => {
    const db = await createTestDb()
    await upsertFile(db, { fileId: FILE_ID, name: 'a.pdf', pages: [{ width: 1, height: 1 }], blobPath: 'p', createdAt: '2026-09-19T00:00:00.000Z' })
    await createJob(db, { id: 'j1', fileId: FILE_ID, records: [{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }] })
    expect(await getJob(db, 'j1')).toMatchObject({ id: 'j1', status: 'queued', total: 3, done: 0, failed: 0, items: [
      { index: 0, status: 'pending', error: null }, { index: 1, status: 'pending', error: null }, { index: 2, status: 'pending', error: null },
    ] })
    expect(await getJobItems(db, 'j1', [2, 0])).toEqual([{ index: 0, record: { Name: 'A' } }, { index: 2, record: { Name: 'C' } }])
    await markItem(db, 'j1', 0, { status: 'done', pdfPath: 'jobs/j1/record-0001.pdf' })
    await markItem(db, 'j1', 1, { status: 'failed', error: 'boom' })
    const job = (await getJob(db, 'j1'))!
    expect([job.done, job.failed]).toEqual([1, 1])
    expect(job.items[1]).toEqual({ index: 1, status: 'failed', error: 'boom' })
    expect(await listDoneItemPaths(db, 'j1')).toEqual([{ index: 0, pdfPath: 'jobs/j1/record-0001.pdf' }])
    await setJobStatus(db, 'j1', { status: 'done', zipPath: 'jobs/j1/all.zip', finishedAt: new Date('2026-09-19T01:00:00.000Z') })
    expect(await getJob(db, 'j1')).toMatchObject({ status: 'done', finishedAt: '2026-09-19T01:00:00.000Z' })
    expect(await getJob(db, 'nope')).toBeNull()
  })
})
```
`apps/api/test/routes.jobs.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { testDeps } from './helpers/deps.js'
import { FILE_ID, putTestFile, slot } from './helpers/fixtures.js'
import { setJobStatus } from '../src/db/jobs.js'

const auth = { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }
const post = (body: unknown, headers: Record<string, string> = auth) => ({ method: 'POST', headers, body: JSON.stringify(body) })

async function withLayout(app: ReturnType<typeof createApp>) {
  await putTestFile(app)
  await app.request(`/files/${FILE_ID}/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: FILE_ID, updatedAt: 't', slots: [slot()] }) })
}

describe('jobs routes', () => {
  it('needs the API key', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }, { 'Content-Type': 'application/json' }))).status).toBe(401)
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }, { ...auth, Authorization: 'Bearer wrong' }))).status).toBe(401)
  })
  it('creates a job, starts the workflow, and reports status', async () => {
    const startJob = vi.fn(async () => {})
    const deps = await testDeps({ startJob })
    const app = createApp(deps)
    await withLayout(app)
    const res = await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }, { Name: 'B' }] }))
    expect(res.status).toBe(202)
    const { jobId } = await res.json()
    expect(startJob).toHaveBeenCalledWith(jobId)
    expect(await (await app.request(`/jobs/${jobId}`)).json()).toMatchObject({ id: jobId, fileId: FILE_ID, status: 'queued', total: 2, items: [{ index: 0, status: 'pending' }, { index: 1, status: 'pending' }] })
  })
  it('400 without a layout or with no records; 404 for an unknown file or job', async () => {
    const app = createApp(await testDeps())
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))).status).toBe(404)
    await putTestFile(app)
    const noLayout = await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))
    expect(noLayout.status).toBe(400)
    expect((await noLayout.json()).error.code).toBe('no_layout')
    expect((await app.request(`/files/${FILE_ID}/jobs`, post({ records: [] }))).status).toBe(400)
    expect((await app.request('/jobs/nope')).status).toBe(404)
  })
  it('the zip is only available once the job is done', async () => {
    const deps = await testDeps()
    const app = createApp(deps)
    await withLayout(app)
    const { jobId } = await (await app.request(`/files/${FILE_ID}/jobs`, post({ records: [{ Name: 'A' }] }))).json()
    expect((await app.request(`/jobs/${jobId}/zip`)).status).toBe(409)
    await deps.blobs.put(`jobs/${jobId}/all.zip`, new Uint8Array([80, 75]), 'application/zip')
    await setJobStatus(deps.db, jobId, { status: 'done', zipPath: `jobs/${jobId}/all.zip`, finishedAt: new Date() })
    const zip = await app.request(`/jobs/${jobId}/zip`)
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toBe('application/zip')
    expect(zip.headers.get('content-disposition')).toBe(`attachment; filename="${jobId}.zip"`)
    expect(Array.from(new Uint8Array(await zip.arrayBuffer()))).toEqual([80, 75])
  })
})
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/jobs/records.ts`:
```ts
import type { TemplateLayout } from '@pdf-slot/core'
import type { JobRecord } from '@pdf-slot/contracts'

/** A record is keyed by slot *name*; the renderer wants slot *id* -> text. Missing names stay blank, unknown keys are ignored. */
export function recordToValues(layout: TemplateLayout, record: JobRecord): Record<string, string> {
  const values: Record<string, string> = {}
  for (const slot of layout.slots) {
    const text = record[slot.name]
    if (text !== undefined && text !== '') values[slot.id] = text
  }
  return values
}

export const itemFileName = (index: number) => `record-${String(index + 1).padStart(4, '0')}.pdf`
export const itemPath = (jobId: string, index: number) => `jobs/${jobId}/${itemFileName(index)}`
export const zipPath = (jobId: string) => `jobs/${jobId}/all.zip`
```
`apps/api/src/db/jobs.ts` (append to the Task 5 file):
```ts
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { JobRecord, JobStatus } from '@pdf-slot/contracts'
import { iso } from './client.js'

export async function createJob(db: Db, input: { id: string; fileId: string; records: JobRecord[] }): Promise<void> {
  await db.insert(jobs).values({ id: input.id, fileId: input.fileId, status: 'queued', total: input.records.length })
  // Chunked: a single statement with 5000 rows is fine for Postgres but not for every driver's parameter limit.
  for (let i = 0; i < input.records.length; i += 500) {
    await db.insert(jobItems).values(input.records.slice(i, i + 500).map((record, j) => ({ jobId: input.id, index: i + j, record })))
  }
}

export async function getJobRow(db: Db, id: string) {
  const [r] = await db.select({ id: jobs.id, fileId: jobs.fileId, status: jobs.status, total: jobs.total, zipPath: jobs.zipPath }).from(jobs).where(eq(jobs.id, id)).limit(1)
  return r ?? null
}

export async function getJob(db: Db, id: string): Promise<JobStatus | null> {
  const [r] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1)
  if (!r) return null
  const items = await db.select({ index: jobItems.index, status: jobItems.status, error: jobItems.error })
    .from(jobItems).where(eq(jobItems.jobId, id)).orderBy(asc(jobItems.index))
  return {
    id: r.id, fileId: r.fileId, status: r.status, total: r.total, done: r.done, failed: r.failed, error: r.error,
    createdAt: iso(r.createdAt), finishedAt: r.finishedAt ? iso(r.finishedAt) : null, items,
  }
}

export async function getJobItems(db: Db, jobId: string, indices: number[]): Promise<{ index: number; record: JobRecord }[]> {
  return db.select({ index: jobItems.index, record: jobItems.record }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), inArray(jobItems.index, indices))).orderBy(asc(jobItems.index))
}

export async function markItem(
  db: Db, jobId: string, index: number,
  result: { status: 'done'; pdfPath: string } | { status: 'failed'; error: string },
): Promise<void> {
  const patch = result.status === 'done' ? { status: 'done' as const, pdfPath: result.pdfPath, error: null } : { status: 'failed' as const, error: result.error, pdfPath: null }
  await db.update(jobItems).set(patch).where(and(eq(jobItems.jobId, jobId), eq(jobItems.index, index)))
  const counter = result.status === 'done' ? jobs.done : jobs.failed
  await db.update(jobs).set({ [result.status === 'done' ? 'done' : 'failed']: sql`${counter} + 1`, status: 'running' }).where(eq(jobs.id, jobId))
}

export async function setJobStatus(
  db: Db, id: string,
  patch: { status: 'queued' | 'running' | 'done' | 'failed'; error?: string | null; zipPath?: string | null; finishedAt?: Date | null },
): Promise<void> {
  await db.update(jobs).set(patch).where(eq(jobs.id, id))
}

export async function listDoneItemPaths(db: Db, jobId: string): Promise<{ index: number; pdfPath: string }[]> {
  const rows = await db.select({ index: jobItems.index, pdfPath: jobItems.pdfPath }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, 'done'))).orderBy(asc(jobItems.index))
  return rows.flatMap((r) => (r.pdfPath ? [{ index: r.index, pdfPath: r.pdfPath }] : []))
}
```
`apps/api/src/routes/jobs.ts`:
```ts
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { zValidator } from '@hono/zod-validator'
import { createJobRequestSchema } from '@pdf-slot/contracts'
import type { AppEnv } from '../app.js'
import { ApiError, notFound } from '../errors.js'
import { getFileMeta } from '../db/files.js'
import { getLayout } from '../db/layouts.js'
import { createJob, getJob, getJobRow } from '../db/jobs.js'
import { fileIdParam } from './files.js'

export const jobsRoutes = new Hono<AppEnv>()

jobsRoutes.post(
  '/files/:id/jobs',
  // The one endpoint that costs real compute: only callers holding the workspace key may start a job.
  async (c, next) => bearerAuth({ token: c.get('deps').config.apiKey })(c, next),
  zValidator('json', createJobRequestSchema, (result) => {
    if (!result.success) throw new ApiError(400, 'invalid_request', 'records must be 1..5000 objects of strings')
  }),
  async (c) => {
    const { db, startJob } = c.get('deps')
    const fileId = fileIdParam(c.req.param('id'))
    if (!(await getFileMeta(db, fileId))) throw notFound('File')
    const layout = await getLayout(db, fileId)
    if (!layout || layout.slots.length === 0) throw new ApiError(400, 'no_layout', 'Lay out at least one slot before generating')
    const id = crypto.randomUUID()
    await createJob(db, { id, fileId, records: c.req.valid('json').records })
    await startJob(id)
    return c.json({ jobId: id }, 202)
  },
)

jobsRoutes.get('/jobs/:id', async (c) => {
  const job = await getJob(c.get('deps').db, c.req.param('id'))
  if (!job) throw notFound('Job')
  return c.json(job)
})

jobsRoutes.get('/jobs/:id/zip', async (c) => {
  const { db, blobs } = c.get('deps')
  const row = await getJobRow(db, c.req.param('id'))
  if (!row) throw notFound('Job')
  if (row.status !== 'done' || !row.zipPath) throw new ApiError(409, 'not_ready', 'The job has not finished')
  const object = await blobs.get(row.zipPath)
  if (!object) throw notFound('Zip')
  return c.body(object.stream, 200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${row.id}.zip"` })
})
```

- [ ] **Step 4: Run tests + typecheck + lint** → pass.
- [ ] **Step 5: Commit** — `git add apps/api/src apps/api/test && git commit -m "feat(api): bulk job creation behind the API key, job status and zip download"`

---

### Task 8: Generation — fonts, zip stream, steps, workflow

**Files:**
- Create: `apps/api/src/jobs/fonts.ts`, `apps/api/src/jobs/zip.ts`, `apps/api/src/jobs/context.ts`, `apps/api/src/jobs/steps.ts`, `apps/api/src/jobs/generateJob.ts`
- Test: `apps/api/test/zip.test.ts`, `apps/api/test/steps.test.ts`

**Interfaces:**
- Produces: `type FontSource = (fileName: string) => Promise<Uint8Array>`; `diskFontSource(dir: string): FontSource`; `loadFonts(source: FontSource): Promise<FontBytes>`; `zipStream(entries: AsyncIterable<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array>`; `type JobContext = { db: Db; blobs: BlobStore; fonts(): Promise<FontBytes> }`; `setJobContext(ctx)`, `getJobContext(): Promise<JobContext>`; steps `loadJob(jobId): Promise<{ batches: number[][] }>`, `renderBatch(jobId, indices): Promise<void>`, `finishJob(jobId): Promise<void>`; workflow `generateJob(jobId): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/zip.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { zipStream } from '../src/jobs/zip.js'
import { readAll } from '../src/blob/blobStore.js'

describe('zipStream', () => {
  it('produces a zip holding every entry, in order, byte-exact', async () => {
    async function* entries() {
      yield { name: 'a.pdf', bytes: new Uint8Array([1, 2, 3]) }
      yield { name: 'b.pdf', bytes: new Uint8Array(70_000).fill(7) }
    }
    const zip = await readAll(zipStream(entries()))
    const files = unzipSync(zip)
    expect(Object.keys(files)).toEqual(['a.pdf', 'b.pdf'])
    expect(Array.from(files['a.pdf']!)).toEqual([1, 2, 3])
    expect(files['b.pdf']!.length).toBe(70_000)
  })
})
```
`apps/api/test/steps.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { normalizePdf, renderPdf, toSlots } from '@pdf-slot/core'
import { createTestDb } from './helpers/db.js'
import { createMemoryBlobStore } from '../src/blob/memoryBlobStore.js'
import { readAll } from '../src/blob/blobStore.js'
import { upsertFile } from '../src/db/files.js'
import { putLayout } from '../src/db/layouts.js'
import { createJob, getJob } from '../src/db/jobs.js'
import { setJobContext } from '../src/jobs/context.js'
import { finishJob, loadJob, renderBatch } from '../src/jobs/steps.js'
import { itemPath, zipPath } from '../src/jobs/records.js'
import { coreFonts, FILE_ID, slot, twoPagePdf } from './helpers/fixtures.js'
import { requireContentStreamText } from '../../../packages/core/test/helpers/content-stream.js'

const fonts = coreFonts()

async function setup(records: Record<string, string>[]) {
  const db = await createTestDb()
  const blobs = createMemoryBlobStore()
  const bytes = await twoPagePdf()
  await blobs.put(`files/${FILE_ID}.pdf`, bytes, 'application/pdf')
  await upsertFile(db, { fileId: FILE_ID, name: 'form.pdf', pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }], blobPath: `files/${FILE_ID}.pdf`, createdAt: 't' })
  const layout = { fileId: FILE_ID, updatedAt: 't', slots: [slot(), slot({ id: 's2', name: 'Date', order: 1, page: 1, fontId: 'mono' })] } as never
  await putLayout(db, layout)
  await createJob(db, { id: 'j1', fileId: FILE_ID, records })
  setJobContext({ db, blobs, fonts: async () => fonts })
  return { db, blobs, bytes, layout }
}

describe('generation steps', () => {
  it('loadJob batches pending indices by 25', async () => {
    await setup(Array.from({ length: 60 }, (_, i) => ({ Name: `n${i}` })))
    const { batches } = await loadJob('j1')
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10])
    expect(batches[0]![0]).toBe(0)
  })

  it('renderBatch writes one PDF per record equal to renderPdf with the same slots; a bad character fails only its item', async () => {
    const { db, blobs, bytes, layout } = await setup([{ Name: 'Abel', Date: '18 Sep' }, { Name: 'Sara', Date: 'Кириллица' }])
    await renderBatch('j1', [0, 1])
    const job = (await getJob(db, 'j1'))!
    expect(job.items[0]).toEqual({ index: 0, status: 'done', error: null })
    expect(job.items[1]!.status).toBe('failed')
    expect(job.items[1]!.error).toMatch(/Date/)
    expect([job.done, job.failed]).toEqual([1, 1])

    const generated = await readAll((await blobs.get(itemPath('j1', 0)))!.stream)
    const doc = await normalizePdf(bytes, FILE_ID)
    const expected = await renderPdf(doc, toSlots(layout, { fileId: FILE_ID, updatedAt: 't', values: { s1: 'Abel', s2: '18 Sep' } }), fonts)
    expect(requireContentStreamText(generated)).toBe(requireContentStreamText(expected))
  })

  it('finishJob zips the done items and marks the job done; zero done items marks it failed', async () => {
    const { db, blobs } = await setup([{ Name: 'A' }, { Name: 'B' }])
    await renderBatch('j1', [0, 1])
    await finishJob('j1')
    expect(await getJob(db, 'j1')).toMatchObject({ status: 'done', done: 2, failed: 0 })
    const zip = unzipSync(await readAll((await blobs.get(zipPath('j1')))!.stream))
    expect(Object.keys(zip)).toEqual(['record-0001.pdf', 'record-0002.pdf'])

    const bad = await setup([{ Name: 'Кириллица' }])
    setJobContext({ db: bad.db, blobs: bad.blobs, fonts: async () => fonts })
    await renderBatch('j1', [0])
    await finishJob('j1')
    expect(await getJob(bad.db, 'j1')).toMatchObject({ status: 'failed', failed: 1 })
  })
})
```
(The `slot()` fixture uses `fontId: 'sans'` — PT Sans covers Cyrillic, which is why the failing record puts Cyrillic in the **mono** slot `Date`: IBM Plex Mono does not. The test asserts the error names the slot.)

- [ ] **Step 2: Run to verify they fail** → FAIL (modules missing).

- [ ] **Step 3: Implement**

`apps/api/src/jobs/fonts.ts`:
```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FONT_FILES, FONT_IDS, type FontBytes } from '@pdf-slot/core'

/** Where font bytes come from: disk in tests/dev, Nitro server assets in production (see runtime.ts). */
export type FontSource = (fileName: string) => Promise<Uint8Array>

export const diskFontSource = (dir: string): FontSource => (name) => readFile(path.join(dir, name)).then((b) => new Uint8Array(b))

export async function loadFonts(source: FontSource): Promise<FontBytes> {
  const entries = await Promise.all(FONT_IDS.map(async (id) => [id, await source(FONT_FILES[id])] as const))
  return Object.fromEntries(entries) as FontBytes
}
```
`apps/api/src/jobs/zip.ts`:
```ts
import { Zip, ZipPassThrough } from 'fflate'

/**
 * A zip as a stream, one entry at a time, so a thousand PDFs never sit in
 * memory together. Entries are stored, not deflated: PDF streams are
 * already compressed, so deflate would only spend CPU.
 */
export function zipStream(entries: AsyncIterable<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return }
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      try {
        for await (const { name, bytes } of entries) {
          const entry = new ZipPassThrough(name)
          zip.add(entry)
          entry.push(bytes, true)
        }
        zip.end()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
```
`apps/api/src/jobs/context.ts`:
```ts
import type { FontBytes } from '@pdf-slot/core'
import type { Db } from '../db/client.js'
import type { BlobStore } from '../blob/blobStore.js'

/** What a generation step needs. Steps run in their own invocations, so they cannot receive this as an argument (Workflow arguments must be serialisable); it is process-level state, set by tests directly and built from the environment in production on first use. */
export type JobContext = { db: Db; blobs: BlobStore; fonts(): Promise<FontBytes> }

let current: JobContext | null = null

export function setJobContext(ctx: JobContext): void {
  current = ctx
}

export async function getJobContext(): Promise<JobContext> {
  if (!current) {
    // Lazy and dynamic on purpose: runtime.ts imports nitro/runtime, which only exists inside a Nitro build.
    const { productionJobContext } = await import('../runtime.js')
    current = await productionJobContext()
  }
  return current
}
```
`apps/api/src/jobs/steps.ts`:
```ts
import { createFontMetrics, describeUnsupportedCharacters, findUnsupportedSlots, normalizePdf, renderPdf, toSlots, type EditorDocument, type FontBytes, type FontId, type FontMetrics, type TemplateLayout } from '@pdf-slot/core'
import { JOB_BATCH_SIZE } from '@pdf-slot/contracts'
import { FatalError } from 'workflow'
import { readAll } from '../blob/blobStore.js'
import { getFileMeta } from '../db/files.js'
import { getLayout } from '../db/layouts.js'
import { getJobItems, getJobRow, listDoneItemPaths, markItem, setJobStatus } from '../db/jobs.js'
import { getJobContext } from './context.js'
import { itemFileName, itemPath, recordToValues, zipPath } from './records.js'
import { zipStream } from './zip.js'

/** Metrics are parsed from the font bytes once per process, not once per PDF. */
const metricsCache = new WeakMap<FontBytes, Record<FontId, FontMetrics>>()
function metricsFor(fonts: FontBytes): (id: FontId) => FontMetrics {
  let table = metricsCache.get(fonts)
  if (!table) {
    table = Object.fromEntries(Object.entries(fonts).map(([id, bytes]) => [id, createFontMetrics(bytes)])) as Record<FontId, FontMetrics>
    metricsCache.set(fonts, table)
  }
  return (id) => table![id]
}

export async function loadJob(jobId: string): Promise<{ batches: number[][] }> {
  'use step'
  const { db } = await getJobContext()
  const row = await getJobRow(db, jobId)
  if (!row) throw new FatalError(`Job ${jobId} does not exist`)
  await setJobStatus(db, jobId, { status: 'running' })
  const batches: number[][] = []
  for (let i = 0; i < row.total; i += JOB_BATCH_SIZE) batches.push(Array.from({ length: Math.min(JOB_BATCH_SIZE, row.total - i) }, (_, j) => i + j))
  return { batches }
}

async function loadTemplate(jobId: string): Promise<{ doc: EditorDocument; layout: TemplateLayout }> {
  const { db, blobs } = await getJobContext()
  const row = await getJobRow(db, jobId)
  if (!row) throw new FatalError(`Job ${jobId} does not exist`)
  const [file, layout] = await Promise.all([getFileMeta(db, row.fileId), getLayout(db, row.fileId)])
  if (!file || !layout) throw new FatalError(`File or layout for job ${jobId} is gone`)
  const object = await blobs.get(file.blobPath)
  if (!object) throw new FatalError(`Source bytes for ${row.fileId} are gone`)
  return { doc: await normalizePdf(await readAll(object.stream), row.fileId), layout }
}

export async function renderBatch(jobId: string, indices: number[]): Promise<void> {
  'use step'
  const ctx = await getJobContext()
  const [{ doc, layout }, fonts, items] = await Promise.all([loadTemplate(jobId), ctx.fonts(), getJobItems(ctx.db, jobId, indices)])
  const metrics = metricsFor(fonts)
  for (const { index, record } of items) {
    const slots = toSlots(layout, { fileId: layout.fileId, updatedAt: layout.updatedAt, values: recordToValues(layout, record) })
    const unsupported = findUnsupportedSlots(slots, metrics)
    if (unsupported.length > 0) {
      const names = unsupported.map((u) => `${layout.slots.find((s) => s.id === u.slotId)?.name ?? u.slotId}: ${describeUnsupportedCharacters(u.characters)}`)
      await markItem(ctx.db, jobId, index, { status: 'failed', error: `Characters the font cannot draw -- ${names.join('; ')}` })
      continue
    }
    try {
      const bytes = await renderPdf(doc, slots, fonts)
      await ctx.blobs.put(itemPath(jobId, index), bytes, 'application/pdf')
      await markItem(ctx.db, jobId, index, { status: 'done', pdfPath: itemPath(jobId, index) })
    } catch (err) {
      await markItem(ctx.db, jobId, index, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
}

export async function finishJob(jobId: string): Promise<void> {
  'use step'
  const { db, blobs } = await getJobContext()
  const done = await listDoneItemPaths(db, jobId)
  if (done.length === 0) {
    await setJobStatus(db, jobId, { status: 'failed', error: 'No record could be rendered', finishedAt: new Date() })
    return
  }
  async function* entries() {
    for (const { index, pdfPath } of done) {
      const object = await blobs.get(pdfPath)
      if (object) yield { name: itemFileName(index), bytes: await readAll(object.stream) }
    }
  }
  await blobs.put(zipPath(jobId), zipStream(entries()), 'application/zip')
  await setJobStatus(db, jobId, { status: 'done', zipPath: zipPath(jobId), finishedAt: new Date() })
}
```
`apps/api/src/jobs/generateJob.ts`:
```ts
import { FatalError } from 'workflow'
import { finishJob, loadJob, renderBatch } from './steps.js'
import { getJobContext } from './context.js'
import { setJobStatus } from '../db/jobs.js'

/** One PDF per record, in batches, then a zip. Each step is retried by Workflow on a thrown error; a FatalError marks the job failed. */
export async function generateJob(jobId: string): Promise<void> {
  'use workflow'
  try {
    const { batches } = await loadJob(jobId)
    for (const batch of batches) await renderBatch(jobId, batch)
    await finishJob(jobId)
  } catch (err) {
    await markJobFailed(jobId, err instanceof Error ? err.message : String(err))
    throw new FatalError(`Job ${jobId} failed`)
  }
}

async function markJobFailed(jobId: string, message: string): Promise<void> {
  'use step'
  const { db } = await getJobContext()
  await setJobStatus(db, jobId, { status: 'failed', error: message, finishedAt: new Date() })
}
```
`packages/core/test/helpers/content-stream.js` is imported by the steps test through a relative path across workspaces; if vitest refuses to resolve `.js` → `.ts` there, copy the helper's `requireContentStreamText` into `apps/api/test/helpers/contentStream.ts` and import that instead.

- [ ] **Step 4: Run tests + typecheck + lint** → pass (`'use step'` / `'use workflow'` are plain strings outside the Nitro build; ESLint may flag unused expressions — add `'@typescript-eslint/no-unused-expressions': 'off'` for `src/jobs/**` in `eslint.config.mjs`).
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): generation steps and workflow -- render per record, zip, mark job"`

---

### Task 9: Production wiring + deployment config

**Files:**
- Modify: `apps/api/src/runtime.ts`, `apps/api/package.json`, root `package.json` (`lint`, `verify`), `README.md` (a "Backend" section)
- Create: `apps/api/README.md`

**Interfaces:**
- Produces: `productionDeps(): Promise<Deps>`, `productionJobContext(): Promise<JobContext>`.

- [ ] **Step 1: Implement runtime**

`apps/api/src/runtime.ts`:
```ts
import { useStorage } from 'nitro/runtime'
import { start } from 'workflow/api'
import type { Deps } from './app.js'
import { readConfig } from './config.js'
import { createDb } from './db/client.js'
import { createVercelBlobStore } from './blob/vercelBlobStore.js'
import { loadFonts, type FontSource } from './jobs/fonts.js'
import type { JobContext } from './jobs/context.js'
import { generateJob } from './jobs/generateJob.js'

const config = readConfig(process.env)
const db = createDb(config.databaseUrl)
const blobs = createVercelBlobStore(config.blobToken)

/** Fonts bundled by nitro.config.ts `serverAssets` from packages/core. */
const nitroFontSource: FontSource = async (name) => {
  const raw = await useStorage('assets:fonts').getItemRaw<Buffer | Uint8Array>(name)
  if (!raw) throw new Error(`Font asset ${name} is missing from the build`)
  return new Uint8Array(raw)
}
let fontsPromise: Promise<Awaited<ReturnType<typeof loadFonts>>> | null = null
const fonts = () => (fontsPromise ??= loadFonts(nitroFontSource))

export async function productionDeps(): Promise<Deps> {
  return { db, blobs, config, startJob: async (jobId) => { await start(generateJob, [jobId]) } }
}

export async function productionJobContext(): Promise<JobContext> {
  return { db, blobs, fonts }
}
```
`apps/api/README.md`: how to run (`cp .env.example .env`, `npm run dev -w api`), how tests work (PGlite, no services), how to deploy (below).

- [ ] **Step 2: Build locally** — `cd apps/api && npm run build` must succeed (Nitro + Workflow compile). Fix any import the sandbox rejects by moving it into a step. Then `npm run dev -w api` and `curl localhost:3000/health` → `{"ok":true}` with a `.env` pointing at any Postgres (a Neon branch, or `docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17` + `npm run db:migrate -w api`).

- [ ] **Step 3: Root scripts** — root `package.json`: `"lint": "npm run lint --workspace=web && npm run lint --workspace=api"`; `verify` unchanged (it composes lint/typecheck/test/build). Run `npm run verify` at the root → green.

- [ ] **Step 4: Commit** — `git add apps/api package.json README.md && git commit -m "feat(api): production wiring on Nitro with Neon, Vercel Blob and Workflow"`

- [ ] **Step 5: Provision and deploy** (done with the user, needs the Vercel account): from `apps/api`: `vercel link` (new project `pdf-slot-api`, root dir `apps/api`, framework Nitro); `vercel integration add neon` (Postgres, injects `DATABASE_URL`); `vercel blob store add pdf-slot-files` (injects `BLOB_READ_WRITE_TOKEN`); `vercel env add API_KEY production`, `vercel env add WEB_ORIGIN production` = `https://pdf-slot-design.vercel.app`; run migrations against the production `DATABASE_URL` (`vercel env pull .env.production.local && DATABASE_URL=... npm run db:migrate`); `vercel deploy --prod --archive=tgz`. Then on the web project: `vercel env add NEXT_PUBLIC_API_URL production` = the API's URL, redeploy web.

---

### Task 10: Web — `HttpTemplateStore` and store selection

**Files:**
- Create: `apps/web/src/lib/persistence/httpTemplateStore.ts`, `apps/web/src/lib/persistence/index.ts`
- Modify: `apps/web/src/app/page.tsx:10` (import), `apps/web/package.json` (add `@pdf-slot/contracts`)
- Test: `apps/web/test/httpTemplateStore.test.ts`, `apps/web/test/persistence.index.test.ts`

**Interfaces:**
- Produces: `createHttpTemplateStore(baseUrl: string): TemplateStore`; `selectStores(env: { apiUrl?: string }, idb: TemplateStore & SessionStore, http: (url: string) => TemplateStore): TemplateStore & SessionStore`; `templateStore` (the chosen instance) and `apiUrl` from `lib/persistence/index.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/httpTemplateStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpTemplateStore } from '@/lib/persistence/httpTemplateStore'

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

const fileId = 'a'.repeat(64)
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('HttpTemplateStore', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => vi.unstubAllGlobals())
  const store = () => createHttpTemplateStore('http://api.test')

  it('getFile joins meta and bytes; null on 404', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: 't' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }))
    const file = await store().getFile(fileId)
    expect(file).toEqual({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: 't', source: new Uint8Array([1, 2]) })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([`http://api.test/files/${fileId}`, `http://api.test/files/${fileId}/source`])
    fetchMock.mockResolvedValueOnce(okJson({ error: { code: 'not_found', message: 'x' } }, 404))
    expect(await store().getFile(fileId)).toBeNull()
  })

  it('putFile sends multipart meta + source', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().putFile({ fileId, name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: 't', source: new Uint8Array([9]) })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/files/${fileId}`)
    expect(init?.method).toBe('PUT')
    const form = init?.body as FormData
    expect(JSON.parse(form.get('meta') as string)).toEqual({ name: 'a.pdf', pages: [{ width: 1, height: 1 }], createdAt: 't' })
    expect((form.get('source') as File).size).toBe(1)
  })

  it('layout/values/list/delete map to their routes; a network failure never rejects', async () => {
    const layout = { fileId, updatedAt: 't', slots: [] }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().putLayout(layout)
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('PUT')
    fetchMock.mockResolvedValueOnce(okJson(layout))
    expect(await store().getLayout(fileId)).toEqual(layout)
    fetchMock.mockResolvedValueOnce(okJson([{ fileId, name: 'a.pdf', pageCount: 1, slotCount: 0, updatedAt: 't' }]))
    expect((await store().listFiles())[0]?.name).toBe('a.pdf')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store().deleteFile(fileId)
    expect(fetchMock.mock.calls.at(-1)![1]?.method).toBe('DELETE')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(store().getValues(fileId)).resolves.toBeNull()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(store().putValues({ fileId, updatedAt: 't', values: {} })).resolves.toBeUndefined()
  })
})
```
`apps/web/test/persistence.index.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { selectStores } from '@/lib/persistence/index'
import type { SessionStore, TemplateStore } from '@/lib/persistence/templateStore'

function fakeIdb(): TemplateStore & SessionStore {
  return {
    getFile: vi.fn(async () => null), putFile: vi.fn(async () => {}), getLayout: vi.fn(async () => null), putLayout: vi.fn(async () => {}),
    getValues: vi.fn(async () => null), putValues: vi.fn(async () => {}), listFiles: vi.fn(async () => []), deleteFile: vi.fn(async () => {}),
    get: vi.fn(async () => null), put: vi.fn(async () => {}), clear: vi.fn(async () => {}),
  }
}

describe('selectStores', () => {
  it('no API URL: IndexedDB for everything (today\'s behaviour)', () => {
    const idb = fakeIdb()
    const http = vi.fn()
    expect(selectStores({}, idb, http)).toBe(idb)
    expect(http).not.toHaveBeenCalled()
  })
  it('API URL set: HTTP for templates, IndexedDB for the session; deleting the open file clears the session', async () => {
    const idb = fakeIdb()
    const httpStore = { ...fakeIdb(), deleteFile: vi.fn(async () => {}) }
    const selected = selectStores({ apiUrl: 'http://api.test/' }, idb, () => httpStore)
    await selected.putLayout({ fileId: 'a', updatedAt: 't', slots: [] })
    expect(httpStore.putLayout).toHaveBeenCalled()
    await selected.put({ fileId: 'a', step: 'layout' })
    expect(idb.put).toHaveBeenCalled()
    ;(idb.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ fileId: 'a', step: 'layout' })
    await selected.deleteFile('a')
    expect(httpStore.deleteFile).toHaveBeenCalledWith('a')
    expect(idb.clear).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `cd apps/web && npx vitest run test/httpTemplateStore.test.ts test/persistence.index.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`npm i -w web @pdf-slot/contracts@0.0.0` (workspace link).

`apps/web/src/lib/persistence/httpTemplateStore.ts`:
```ts
import { toast } from 'sonner'
import type { FileId, StoredFile, TemplateLayout, TemplateValues } from '@pdf-slot/core'
import { fileMetaSchema, storedFileSummarySchema, templateLayoutSchema, templateValuesSchema } from '@pdf-slot/contracts'
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
 * `TemplateStore` over the Hono API. Same contract as the IndexedDB store:
 * never rejects -- a failed request warns once and reads as "nothing
 * saved" / drops the write. Shapes are validated with the shared
 * contracts, so a server that drifts is caught here, not deep in the editor.
 */
export function createHttpTemplateStore(baseUrl: string): TemplateStore {
  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`

  async function request(path: string, init?: RequestInit): Promise<Response | null> {
    try {
      const res = await fetch(url(path), init)
      if (res.status === 404) return null
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
      return { ...meta, source: new Uint8Array(await res.arrayBuffer()) }
    },
    async putFile(file: StoredFile): Promise<void> {
      const form = new FormData()
      form.set('meta', JSON.stringify({ name: file.name, pages: file.pages, createdAt: file.createdAt }))
      form.set('source', new Blob([file.source], { type: 'application/pdf' }), file.name)
      await request(`/files/${file.fileId}`, { method: 'PUT', body: form })
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
```
`apps/web/src/lib/persistence/index.ts`:
```ts
import type { SessionStore, TemplateStore } from './templateStore'
import { templateStore as indexedDb } from './indexedDbTemplateStore'
import { createHttpTemplateStore } from './httpTemplateStore'

/**
 * Which storage the app talks to. With an API URL, files/layouts/values go
 * to the server and only the open session (which file, which step -- a
 * per-device fact) stays in this browser. Without one, everything is in
 * IndexedDB exactly as before, which is also what every test runs against.
 */
export function selectStores(
  env: { apiUrl?: string },
  idb: TemplateStore & SessionStore,
  http: (url: string) => TemplateStore,
): TemplateStore & SessionStore {
  if (!env.apiUrl) return idb
  const remote = http(env.apiUrl)
  return {
    ...remote,
    get: () => idb.get(),
    put: (s) => idb.put(s),
    clear: () => idb.clear(),
    async deleteFile(fileId) {
      await remote.deleteFile(fileId)
      if ((await idb.get())?.fileId === fileId) await idb.clear()
    },
  }
}

export const apiUrl = process.env.NEXT_PUBLIC_API_URL || undefined
export const templateStore = selectStores({ apiUrl }, indexedDb, createHttpTemplateStore)
```
`apps/web/src/app/page.tsx`: change the import to `import { templateStore } from '@/lib/persistence'`.

- [ ] **Step 4: Run the whole web suite** — `cd apps/web && npx vitest run && npx tsc --noEmit && npx eslint src test --max-warnings 0` → all green (existing suites unaffected: `NEXT_PUBLIC_API_URL` is unset under vitest).
- [ ] **Step 5: Commit** — `git add apps/web package-lock.json && git commit -m "feat(web): template store over the API, chosen by NEXT_PUBLIC_API_URL; IndexedDB otherwise"`

---

### Task 11: Web — unique slot names in the name dialog

**Files:**
- Modify: `apps/web/src/features/template/NameSlotDialog.tsx`, `apps/web/src/features/template/TemplateEditor.tsx` (pass `taken`)
- Test: `apps/web/test/NameSlotDialog.test.ts` (extend or create), `apps/web/test/TemplateEditor.test.ts` (one case)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/TemplateEditor.test.ts` (inside the main `describe`):
```ts
  it('refuses a slot name another slot on this file already has', async () => {
    const { TemplateEditor } = await import('../src/features/template/TemplateEditor')
    const store = memoryStore()
    const { container } = render(createElement(TemplateEditor, { opened: newFile, store, onStartOver: vi.fn() }))
    await placeSlot(container, 'Date')
    const canvas = await waitForCanvas(container)
    fireEvent.click(canvas, { clientX: 150, clientY: 150 })
    const input = await waitFor(() => screen.getByTestId('slot-name-input') as HTMLInputElement)
    fireEvent.change(input, { target: { value: 'Date' } })
    expect(screen.getByTestId('slot-name-taken').textContent).toMatch(/already/)
    expect((screen.getByTestId('slot-name-submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(container.querySelectorAll('[data-slot-id]')).toHaveLength(1)
    fireEvent.change(input, { target: { value: 'Date 2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(container.querySelectorAll('[data-slot-id]')).toHaveLength(2))
  })
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/web && npx vitest run test/TemplateEditor.test.ts -t "refuses"` → FAIL (`slot-name-taken` not found).

- [ ] **Step 3: Implement**

`NameSlotDialog.tsx`: add prop `taken?: readonly string[]` (default `[]`); compute `const isTaken = taken.includes(name.trim())`; in `submit()` return early when `isTaken`; disable the submit button when `name.trim() === '' || isTaken`; under the input render
```tsx
{isTaken && (
  <p className="text-xs text-destructive" data-testid="slot-name-taken">
    A slot named “{name.trim()}” already exists on this file. Names must be unique.
  </p>
)}
```
`TemplateEditor.tsx`: pass `taken={Object.entries(names).filter(([id]) => id !== pending?.id).map(([, n]) => n)}` (a rename may keep its own name).

- [ ] **Step 4: Run web suite + lint** → green.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): slot names are unique per file"` (use explicit `git add` of the two source files and the test).

---

### Task 12: Web — Generate panel (records → job → progress → zip)

**Files:**
- Create: `apps/web/src/features/generate/parseRecords.ts`, `apps/web/src/features/generate/jobsClient.ts`, `apps/web/src/features/generate/useJobPolling.ts`, `apps/web/src/features/generate/GeneratePanel.tsx`
- Modify: `apps/web/src/features/template/SlotPanel.tsx` (accept `generate?: ReactNode` rendered after Save in step 2), `apps/web/src/features/template/TemplateEditor.tsx` (render `<GeneratePanel>` when `apiUrl` is set)
- Install: `cd apps/web && npx shadcn@latest add progress` (revert any bogus `cn` dependency the CLI adds, fix the import to `@/lib/utils` — as done for earlier components)
- Test: `apps/web/test/parseRecords.test.ts`, `apps/web/test/GeneratePanel.test.ts`

**Interfaces:**
- Produces: `parseRecords(text: string): { records: Record<string, string>[] } | { error: string }` (JSON array of objects, or CSV with a header row; RFC-4180 quotes); `createJob(apiUrl, fileId, records, apiKey): Promise<{ jobId: string } | { error: string }>`; `fetchJob(apiUrl, jobId): Promise<JobStatus | null>`; `useJobPolling(apiUrl, jobId | null): JobStatus | null` (2 s interval until `done`/`failed`); `GeneratePanel({ apiUrl, fileId })`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/parseRecords.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseRecords } from '@/features/generate/parseRecords'

describe('parseRecords', () => {
  it('accepts a JSON array of string objects', () => {
    expect(parseRecords('[{"Name":"Abel"},{"Name":"Sara"}]')).toEqual({ records: [{ Name: 'Abel' }, { Name: 'Sara' }] })
    expect(parseRecords('{"Name":"Abel"}')).toEqual({ error: 'Expected a JSON array of objects' })
    expect(parseRecords('[{"Name":1}]')).toEqual({ error: 'Every value must be text (row 1, "Name")' })
  })
  it('accepts CSV with a header row, quotes, commas and CRLF', () => {
    expect(parseRecords('Name,Date\r\n"Tesfaye, Abel",18 Sep\r\nSara,"say ""hi"""\r\n')).toEqual({
      records: [{ Name: 'Tesfaye, Abel', Date: '18 Sep' }, { Name: 'Sara', Date: 'say "hi"' }],
    })
    expect(parseRecords('Name\n')).toEqual({ error: 'No rows under the header' })
    expect(parseRecords('')).toEqual({ error: 'Paste a JSON array or CSV' })
  })
})
```
`apps/web/test/GeneratePanel.test.ts`:
```ts
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneratePanel } from '@/features/generate/GeneratePanel'

const fileId = 'a'.repeat(64)
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const status = (over: Partial<Record<string, unknown>>) => ({
  id: 'j1', fileId, status: 'running', total: 2, done: 1, failed: 0, error: null, createdAt: 't', finishedAt: null,
  items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'pending', error: null }], ...over,
})

describe('GeneratePanel', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); localStorage.clear() })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('submits records with the key, shows progress, then the zip link and failed rows', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ jobId: 'j1' }, 202))
      .mockResolvedValueOnce(okJson(status({})))
      .mockResolvedValueOnce(okJson(status({ status: 'done', done: 1, failed: 1, finishedAt: 't2', items: [{ index: 0, status: 'done', error: null }, { index: 1, status: 'failed', error: 'bad char' }] })))
    render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId }))
    fireEvent.change(screen.getByTestId('generate-key'), { target: { value: 'k' } })
    fireEvent.change(screen.getByTestId('generate-records'), { target: { value: '[{"Name":"A"},{"Name":"B"}]' } })
    fireEvent.click(screen.getByTestId('generate-submit'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/files/${fileId}/jobs`)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(String(init?.body))).toEqual({ records: [{ Name: 'A' }, { Name: 'B' }] })
    await waitFor(() => expect(screen.getByTestId('generate-progress').textContent).toContain('1 / 2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await waitFor(() => expect(screen.getByTestId('generate-zip').getAttribute('href')).toBe('http://api.test/jobs/j1/zip'))
    expect(screen.getByTestId('generate-failures').textContent).toContain('Row 2: bad char')
    expect(localStorage.getItem('pdf-slot-api-key')).toBe('k')
  })

  it('shows a parse error without calling the API', () => {
    render(createElement(GeneratePanel, { apiUrl: 'http://api.test', fileId }))
    fireEvent.change(screen.getByTestId('generate-records'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByTestId('generate-submit'))
    expect(screen.getByTestId('generate-error').textContent).toMatch(/JSON array or CSV/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`parseRecords.ts`:
```ts
export type ParsedRecords = { records: Record<string, string>[] } | { error: string }

/** A pasted JSON array of objects, or CSV whose header row names the slots. */
export function parseRecords(text: string): ParsedRecords {
  const trimmed = text.trim()
  if (trimmed === '') return { error: 'Paste a JSON array or CSV' }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJson(trimmed)
  return parseCsv(trimmed)
}

function parseJson(text: string): ParsedRecords {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { error: 'Not valid JSON' } }
  if (!Array.isArray(data)) return { error: 'Expected a JSON array of objects' }
  const records: Record<string, string>[] = []
  for (const [i, row] of data.entries()) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return { error: `Row ${i + 1} is not an object` }
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string') return { error: `Every value must be text (row ${i + 1}, "${key}")` }
    }
    records.push(row as Record<string, string>)
  }
  if (records.length === 0) return { error: 'The array is empty' }
  return { records }
}

/** RFC 4180: fields separated by commas, optionally quoted, quotes doubled inside, CRLF or LF rows. */
function parseCsv(text: string): ParsedRecords {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  const [header, ...body] = rows
  if (!header) return { error: 'No header row' }
  if (body.length === 0) return { error: 'No rows under the header' }
  return { records: body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))) }
}
```
`jobsClient.ts`:
```ts
import { jobStatusSchema, type JobStatus } from '@pdf-slot/contracts'

const base = (apiUrl: string) => apiUrl.replace(/\/$/, '')

export async function createJob(apiUrl: string, fileId: string, records: Record<string, string>[], apiKey: string): Promise<{ jobId: string } | { error: string }> {
  try {
    const res = await fetch(`${base(apiUrl)}/files/${fileId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ records }),
    })
    const body = (await res.json()) as { jobId?: string; error?: { message: string } }
    if (!res.ok) return { error: res.status === 401 ? 'The API key was refused' : body.error?.message ?? `Request failed (${res.status})` }
    return { jobId: body.jobId! }
  } catch {
    return { error: 'The API is unreachable' }
  }
}

export async function fetchJob(apiUrl: string, jobId: string): Promise<JobStatus | null> {
  try {
    const res = await fetch(`${base(apiUrl)}/jobs/${jobId}`)
    if (!res.ok) return null
    return jobStatusSchema.parse(await res.json())
  } catch {
    return null
  }
}

export const zipUrl = (apiUrl: string, jobId: string) => `${base(apiUrl)}/jobs/${jobId}/zip`
```
`useJobPolling.ts`:
```ts
'use client'
import { useEffect, useState } from 'react'
import type { JobStatus } from '@pdf-slot/contracts'
import { fetchJob } from './jobsClient'

const INTERVAL_MS = 2000

/** Polls a job every 2 s until it is done or failed. */
export function useJobPolling(apiUrl: string, jobId: string | null): JobStatus | null {
  const [job, setJob] = useState<JobStatus | null>(null)
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const next = await fetchJob(apiUrl, jobId)
      if (cancelled) return
      if (next) setJob(next)
      if (!next || next.status === 'queued' || next.status === 'running') timer = setTimeout(() => void tick(), INTERVAL_MS)
    }
    void tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [apiUrl, jobId])
  return jobId ? job : null
}
```
`GeneratePanel.tsx` (shadcn: `Label`, `Input`, `Textarea`, `Button`, `Progress`, `Separator`):
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { createJob, zipUrl } from './jobsClient'
import { parseRecords } from './parseRecords'
import { useJobPolling } from './useJobPolling'

const KEY_STORAGE = 'pdf-slot-api-key'
const readKey = () => { try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' } }
const saveKey = (k: string) => { try { localStorage.setItem(KEY_STORAGE, k) } catch { /* storage blocked: the key just isn't remembered */ } }

/** Step 2: paste a list of records, get one PDF per record from the server, download the zip. */
export function GeneratePanel({ apiUrl, fileId }: { apiUrl: string; fileId: string }) {
  const [apiKey, setApiKey] = useState(readKey)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJobPolling(apiUrl, jobId)
  const running = job?.status === 'queued' || job?.status === 'running' || (jobId !== null && job === null)

  const submit = async () => {
    setError(null)
    const parsed = parseRecords(text)
    if ('error' in parsed) { setError(parsed.error); return }
    saveKey(apiKey)
    const result = await createJob(apiUrl, fileId, parsed.records, apiKey)
    if ('error' in result) { setError(result.error); return }
    setJobId(result.jobId)
  }

  const failures = job?.items.filter((i) => i.status === 'failed') ?? []
  return (
    <div className="grid gap-3" data-testid="generate-panel">
      <Separator />
      <div>
        <h3 className="text-sm font-medium">Generate from data</h3>
        <p className="text-xs text-muted-foreground">One PDF per row. Column names must match the slot names.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generate-key">API key</Label>
        <Input id="generate-key" data-testid="generate-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generate-records">Records (JSON array or CSV)</Label>
        <Textarea id="generate-records" data-testid="generate-records" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Name,Date\nAbel,18 Sep 2026'} />
      </div>
      {error && <p className="text-xs text-destructive" data-testid="generate-error">{error}</p>}
      <Button onClick={() => void submit()} disabled={running || text.trim() === '' || apiKey === ''} data-testid="generate-submit">
        {running ? 'Generating…' : 'Generate PDFs'}
      </Button>
      {job && (
        <div className="grid gap-2">
          <Progress value={job.total === 0 ? 0 : ((job.done + job.failed) / job.total) * 100} />
          <p className="text-xs text-muted-foreground" data-testid="generate-progress">
            {job.done + job.failed} / {job.total} {job.status === 'failed' ? `— failed: ${job.error ?? ''}` : ''}
          </p>
          {job.status === 'done' && (
            <Button asChild variant="outline"><a href={zipUrl(apiUrl, job.id)} data-testid="generate-zip">Download zip ({job.done} PDFs)</a></Button>
          )}
          {failures.length > 0 && (
            <ul className="text-xs text-destructive" data-testid="generate-failures">
              {failures.map((f) => <li key={f.index}>Row {f.index + 1}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```
If the installed `Button` has no `asChild` (base-ui variant uses `render`), use `<Button render={<a href=… data-testid="generate-zip" />} variant="outline">…</Button>` — check `components/ui/button.tsx` first.

`SlotPanel.tsx`: add prop `generate?: ReactNode` and render `{generate}` after the Save button in step 2. `TemplateEditor.tsx`: `import { apiUrl } from '@/lib/persistence'` and pass `generate={apiUrl ? <GeneratePanel apiUrl={apiUrl} fileId={fileId} /> : undefined}` to `SlotPanel`.

- [ ] **Step 4: Run web suite + lint + typecheck** → green.
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): generate one PDF per record from the server, with progress and a zip"`

---

### Task 13: End-to-end check and merge readiness

- [ ] **Step 1:** `npm run verify` at the root — every workspace green.
- [ ] **Step 2:** Local run: API (`npm run dev -w api`, `.env` with a Postgres + Blob token, `API_KEY=dev`, `WEB_ORIGIN=http://localhost:3005`) and web with `NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev -w web -- -p 3005`. Upload a PDF, lay out `Name` and `Date`, Next, paste two records, Generate, download the zip, open both PDFs — identical to what the preview showed. Reload the page → same file reopens (session in browser, data from the server). Run the web with the env var unset → IndexedDB behaviour unchanged.
- [ ] **Step 3:** Update the spec's "Testing" and "Deployment" sections if anything above deviated (PGlite, Nitro, streamed zip are already reflected). Commit `docs:` if changed.
