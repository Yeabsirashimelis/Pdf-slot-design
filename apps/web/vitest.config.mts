import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
  // Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping: Vitest (unlike
  // Next's own webpack build) doesn't read tsconfig paths on its own, so
  // without this any src module reached by a test that imports via the
  // "@/..." alias (as most of src/ does) fails to resolve.
  resolve: { alias: { '@': path.resolve(dirname, './src') } },
})
