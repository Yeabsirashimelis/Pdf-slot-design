import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** In-process end-to-end: real Hono handlers + PGlite + memory blobs, driven by the real web store code. */
export default defineConfig({
  test: { environment: 'node', include: ['test/e2e/**/*.e2e.test.ts'], testTimeout: 60_000 },
  // The web modules under test import each other through Next's "@/*" alias (apps/web/tsconfig.json).
  resolve: { alias: { '@': path.resolve(dirname, '../web/src') } },
})
