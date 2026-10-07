import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Editor/TemplateEditor cases mount pdf.js and parse the real TTF fonts
    // in jsdom; under a full parallel run they overshoot the 5s default.
    testTimeout: 20_000,
  },
  // Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping: Vitest (unlike
  // Next's own webpack build) doesn't read tsconfig paths on its own, so
  // without this any src module reached by a test that imports via the
  // "@/..." alias (as most of src/ does) fails to resolve.
  resolve: { alias: { '@': path.resolve(dirname, './src') } },
})
