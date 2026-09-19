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
