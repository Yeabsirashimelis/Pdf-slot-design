# Backend and bulk generation — design

Date: 2026-09-19. Builds on `2026-09-13-two-step-template-editing-design.md`
(the two-step editor and its `TemplateStore`/`SessionStore` interfaces) and on
the render invariant from `2026-09-03-pdf-slot-editor-design.md`.

## Goal

1. **A server holds the data.** Files, layouts and values move from the
   browser's IndexedDB to a Hono API backed by Postgres, so a template laid
   out once is available from any browser and survives the browser's storage
   being cleared. The editor does not change: it already talks to storage
   through `TemplateStore`, and gets a second implementation of it.
2. **Bulk generation.** A layout is a template with named blanks. Given a
   list of records — `[{ "Name": "Abel", "Date": "18 Sep 2026" }, …]` — the
   server writes each record into the slots and produces one PDF per
   record, as a background job with progress, delivered as a zip. Output
   uses the same `renderPdf` the browser uses, so it is identical to the
   preview.

Decisions taken with the user (2026-09-19): the backend is a **separate Hono
app deployed to Vercel** (Fluid compute), Postgres from the Vercel
Marketplace, jobs on **Vercel Workflow**; **one shared workspace, no
sign-in**, with an **API key** guarding bulk generation. Nothing that works
today may break: with no API configured the web app keeps using IndexedDB.

## Shape

```
apps/
  web/        Next.js editor (existing)
  api/        Hono service (new) -- its own Vercel project
packages/
  core/       framework-free layout + render (existing, unchanged)
  contracts/  request/response schemas shared by api and web (new, zod)
```

`packages/contracts` exists so the web client and the server validate the
same shapes from one source; it depends on `@pdf-slot/core` for the domain
types and on `zod`, nothing else.

### Storage

| What | Where | Why |
|---|---|---|
| File metadata, layouts, values, jobs | Postgres (Neon, Marketplace) via Drizzle ORM | relational, queryable, migrations |
| Source PDF bytes, generated PDFs, zips | Vercel Blob, private access | bytes do not belong in Postgres rows; Blob is the platform's file store |
| Open session (which file, which step) | Browser (IndexedDB, as today) | per-device by nature; a reload should land where *this* browser was |

`packages/core`'s `StoredFile.source` stays `Uint8Array` — the HTTP store
fetches the bytes from the API (which proxies from Blob), so nothing above
`TemplateStore` learns about Blob.

### Schema (Drizzle, `apps/api/src/db/schema.ts`)

```
files      file_id text pk  -- SHA-256 of the source bytes (as today)
           name text, page_count int, pages jsonb (PageSize[]),
           blob_url text, created_at timestamptz, updated_at timestamptz
layouts    file_id text pk fk files (cascade), slots jsonb (TemplateSlot[]), updated_at
values     file_id text pk fk files (cascade), values jsonb (Record<slotId,string>), updated_at
jobs       id text pk (random id), file_id fk files, status text
           ('queued'|'running'|'done'|'failed'), total int, done int, failed int,
           zip_url text null, error text null, created_at, finished_at null
job_items  job_id fk jobs (cascade), index int, status text ('pending'|'done'|'failed'),
           pdf_url text null, error text null, pk (job_id, index)
```

`listFiles` reads `files` joined with `layouts` for the slot count — the
same `StoredFileSummary` the start screen shows today.

## API (`apps/api`, Hono)

All bodies JSON except the file upload. Every response is validated against
`packages/contracts` on the way out in tests.

| Method & path | Body → Response | Notes |
|---|---|---|
| `GET /files` | → `StoredFileSummary[]` | newest first |
| `GET /files/:id` | → `StoredFile` metadata (no bytes) | 404 if unknown |
| `GET /files/:id/source` | → `application/pdf` bytes | streamed from Blob |
| `PUT /files/:id` | multipart: `meta` (json), `source` (pdf) → 204 | idempotent: same hash, same file |
| `DELETE /files/:id` | → 204 | cascades layout, values, jobs; deletes blobs |
| `GET /files/:id/layout` | → `TemplateLayout` / 404 | |
| `PUT /files/:id/layout` | `TemplateLayout` → 204 | rejects duplicate slot names (409) |
| `GET /files/:id/values` | → `TemplateValues` / 404 | |
| `PUT /files/:id/values` | `TemplateValues` → 204 | |
| `POST /files/:id/jobs` | `{ records: Record<string,string>[] }` → `{ jobId }` (202) | **Bearer API key**; 400 if no layout or empty records; max 5000 records |
| `GET /jobs/:id` | → `{ status, total, done, failed, zipUrl?, items: [{index,status,error?}] }` | polled by the UI |
| `GET /jobs/:id/zip` | → `application/zip` bytes, streamed from Blob | 409 until `done` |

Errors are `{ error: { code, message } }` with a 4xx/5xx status. CORS allows
the web app's origin (`WEB_ORIGIN` env).

Only `POST /files/:id/jobs` needs the key: reading and editing templates is
what the web app does, and the workspace is shared by decision. A key on
job creation is what stops a stranger from burning compute.

## Bulk pipeline (Vercel Workflow)

```
POST /files/:id/jobs
  → validate records against the layout's slot names
      (a record may omit a slot -- it is left blank; unknown keys are ignored;
       a value that cannot be rendered with the slot's font fails that item)
  → insert jobs + job_items (all 'pending')
  → start(generateJob, [jobId])            -- returns immediately
  → 202 { jobId }

generateJob(jobId)                          "use workflow"
  const { layout, sourceUrl, batches } = await loadJob(jobId)     step
  for each batch of 25 indices:
    await renderBatch(jobId, batch)                                 step (retried by Workflow)
  await finishJob(jobId)                                            step: zip, upload, status 'done'

renderBatch: fetch source bytes once per step, load fonts once per process
  (module-level cache), for each index: toSlots(layout, record) →
  renderPdf → put Blob → job_items done/failed (item errors do not throw).
finishJob: stream every done item's PDF into a zip (fflate, streaming),
  put Blob, set jobs.zip_url, status 'done' (or 'failed' if zero items done).
```

Records are stored on `job_items` as the input of each item so a retried
batch is deterministic. A workflow-level failure (e.g. source blob gone)
marks the job `failed` with `error` set; the UI shows it.

Why Workflow and not a loop in one request: 1000 renders is minutes of
work; a request has a 300 s ceiling; Workflow persists step results and
retries a failed step, so a job cannot silently stop halfway.

## Web app changes

- `apps/web/src/lib/persistence/httpTemplateStore.ts` implements
  `TemplateStore` over `fetch` against `NEXT_PUBLIC_API_URL`. Same
  never-reject contract as the IndexedDB store: a network failure logs,
  warns once (toast) and returns null / drops the write.
- `apps/web/src/lib/persistence/index.ts` picks the store: API URL set →
  HTTP for `TemplateStore`, IndexedDB for `SessionStore`; unset → IndexedDB
  for both (today's behaviour, and what every existing test runs against).
- **Unique slot names per file**: `NameSlotDialog` refuses a name another
  slot on the file already has (inline message, Enter does nothing);
  `copyName` already produces unique names. `toLayout` is unchanged; the
  API is the second line of defence (409).
- **Generate panel** (step 2, below the form): a shadcn `Textarea` to paste
  a JSON array (or a CSV whose header row is the slot names — parsed
  client-side into the same records), a **Generate** button, then a
  `Progress` bar with "142 / 300", a list of failed rows with their
  errors, and a **Download zip** button when done. Polls `GET /jobs/:id`
  every 2 s while running. Hidden when no API URL is configured.
- The API key for generating is entered in the panel once and kept in
  `localStorage` (it is the user's own key; there are no accounts yet).

## Deployment

- `apps/api` is its own Vercel project (Hono on Nitro -- the build system
  the Workflow SDK's Hono guide requires; Node 24, Fluid compute), root
  directory `apps/api`, with Workflow enabled. The renderer's fonts are
  bundled from `packages/core` as Nitro server assets. Env:
  `DATABASE_URL` (injected by the Neon Marketplace integration),
  `BLOB_READ_WRITE_TOKEN` (Blob store), `API_KEY`, `WEB_ORIGIN`.
- `apps/web` gets `NEXT_PUBLIC_API_URL` in production; unset locally unless
  the developer runs the API.
- Migrations: `drizzle-kit generate` checked in; `drizzle-kit migrate` run
  as the API's build step.

## Testing

- `packages/contracts`: schema round-trips for every shape.
- `apps/api`: route tests with Hono's `app.request()` against PGlite (an
  in-process Postgres running the committed migrations -- no Docker, no
  network) and an in-memory blob store behind a small `BlobStore`
  interface (a disk-backed one serves local development without a Blob
  token); the Workflow
  steps are plain functions and are tested directly (fonts + a two-page
  fixture from core), including: a record missing a slot renders blank, an
  unrenderable character fails only that item, the zip contains one PDF
  per done item, and a generated PDF's content stream equals
  `renderPdf` called directly with the same slots (bulk == preview).
- `apps/web`: `httpTemplateStore.test.ts` against a mocked `fetch`;
  `persistence/index.test.ts` for store selection; `NameSlotDialog` refuses
  duplicates; Generate panel test with a fake job endpoint. The existing
  suites run unchanged on IndexedDB.
- `npm run verify` covers all three workspaces.

## Out of scope

User accounts and per-user data; e-mailing generated PDFs; per-record
download links in the UI (the zip is the deliverable; `pdf_url` exists for
integrations); CSV column mapping (headers must equal slot names); rate
limiting beyond the record cap; deleting jobs.
