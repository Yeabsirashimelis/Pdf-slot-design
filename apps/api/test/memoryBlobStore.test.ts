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
