# api

The backend for the PDF text-slot editor: a Hono app on Nitro, storing files/layouts/jobs in
Postgres, source and generated PDFs in Blob storage, and running bulk generation as a durable
[Workflow](https://useworkflow.dev/).

## Running locally

You need a Postgres instance. Either:

- **Docker**: `docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:17`
- **Neon**: create a branch and copy its connection string.

Then, from `apps/api`:

```bash
cp .env.example .env
# edit .env: DATABASE_URL to the instance above; for local files instead of Vercel Blob,
# set BLOB_DIR=.blobs and leave BLOB_READ_WRITE_TOKEN unset
npm run db:migrate   # applies drizzle/*.sql -- needs DATABASE_URL in the environment
npm run dev          # nitro dev, listens on :3000
curl localhost:3000/health   # -> {"ok":true}
```

`npm run build` runs the same Nitro + Workflow compile used for deployment; run it before
shipping to catch anything the production bundle would reject that `dev` does not.

### Environment variables

| Variable                | Required                    | Purpose                                                          |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`           | always                       | Postgres connection string (Neon or any Postgres, over plain TCP via `pg`). |
| `BLOB_READ_WRITE_TOKEN`  | unless `BLOB_DIR` is set     | Vercel Blob token for storing source PDFs, per-record PDFs and zips. |
| `BLOB_DIR`               | instead of the token above   | Local, file-backed blob storage (a directory on disk) for development -- no Vercel Blob account needed. |
| `API_KEY`                | always                       | Bearer token required to start a generation job (`POST /files/:id/jobs`). |
| `WEB_ORIGIN`             | always                       | Origin allowed by CORS (the web app's URL). |

A missing required variable is a startup error (`src/config.ts`), not a runtime surprise.

### Fonts

The five TTFs the renderer embeds are bundled from `packages/core/src/fonts/files` via
`nitro.config.ts`'s `serverAssets`, and read in production through Nitro's `useStorage('assets:fonts')`.
`nitro dev`'s watcher does not mount `serverAssets` the same way `nitro build` does, so
`src/runtime.ts` falls back to reading those files straight off disk (resolved from `apps/api`'s
working directory) whenever the asset lookup comes back empty -- this only ever matters locally;
a real `nitro build` always resolves fonts through the bundled assets.

## Limits

Things a caller or operator should know that the code does not announce on its own:

- **Uploads are capped at 4.5 MB.** `PUT /files/:id` runs as a Vercel Function, and the platform
  rejects a request body over 4.5 MB with a `413` before the handler runs -- so the cap cannot be
  raised in this code, and the `413` body is the platform's plain text, not our error envelope.
  The web client recognises the status and tells the user the PDF is too large to save on the
  server; editing and downloading still work, since neither needs the server. IndexedDB mode (the
  web app without `NEXT_PUBLIC_API_URL`) has no such cap.
- **`GET /jobs/:id` returns every item on every poll.** The response carries the full `items` array
  (one entry per record, up to `MAX_JOB_RECORDS` = 5000), not a delta. The web client polls it every
  two seconds while a job runs; that is fine at the current record limit, and paging or a `since`
  cursor is the change to make if the limit grows.
- **Migrations are applied by hand, not at build.** The design spec had `drizzle-kit migrate` run as
  the API's build step; in practice it is `npm run db:migrate` against the target `DATABASE_URL`
  (see *Deploying*), run before the deploy that needs it. The build then never needs write access
  to the production database, and a schema change stays an explicit, reviewable step rather than a
  side effect of every deploy.
- **Only job creation is authenticated.** `POST /files/:id/jobs` requires the bearer `API_KEY`
  because it is the one endpoint that costs real compute. Every other route -- uploading, reading
  and deleting files, layouts and values, reading job status and downloading a zip -- is open to any
  caller allowed by CORS. That is the intended single-workspace model, not an oversight; a
  multi-tenant deployment would need per-user auth on all of them.

## Tests

```bash
npm test
```

Tests need no external services: the database is [PGlite](https://pglite.dev/) (an in-process
Postgres, see `test/helpers/db.ts`) and blob storage is an in-memory map
(`src/blob/memoryBlobStore.ts`). Nothing is mocked at the network boundary -- the same repository
and route code runs against PGlite as runs against real Postgres in production.

## Deploying

From `apps/api`:

```bash
vercel link                        # new project "pdf-slot-api", root dir apps/api, framework Nitro
vercel integration add neon        # provisions Postgres, injects DATABASE_URL
vercel blob store add pdf-slot-files   # injects BLOB_READ_WRITE_TOKEN
vercel env add API_KEY production
vercel env add WEB_ORIGIN production   # e.g. https://pdf-slot-design.vercel.app

vercel env pull .env.production.local
DATABASE_URL=... npm run db:migrate    # run migrations against the production database

vercel deploy --prod --archive=tgz
```

Then, on the web project: `vercel env add NEXT_PUBLIC_API_URL production` set to the API's
deployed URL, and redeploy web.
