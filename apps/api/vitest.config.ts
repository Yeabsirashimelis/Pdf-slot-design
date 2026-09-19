import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  // test/e2e/** is the in-process end-to-end suite (vitest.e2e.config.ts, `npm run test:e2e`): it needs the web "@/*" alias and is not a unit test.
  test: { environment: 'node', include: ['test/**/*.test.ts'], exclude: [...configDefaults.exclude, 'test/e2e/**'], testTimeout: 30_000 },
})
