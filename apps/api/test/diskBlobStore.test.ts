import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDiskBlobStore } from '../src/blob/diskBlobStore.js'
import { readAll } from '../src/blob/blobStore.js'

describe('disk blob store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'blob-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stores bytes and streams, reads them back with the content type, deletes', async () => {
    const blobs = createDiskBlobStore(dir)
    await blobs.put('a.pdf', new Uint8Array([1, 2, 3]), 'application/pdf')
    await blobs.put('b.zip', new ReadableStream({ start(c) { c.enqueue(new Uint8Array([9])); c.close() } }), 'application/zip')
    const a = await blobs.get('a.pdf')
    expect(a?.contentType).toBe('application/pdf')
    expect(Array.from(await readAll(a!.stream))).toEqual([1, 2, 3])
    expect(Array.from(await readAll((await blobs.get('b.zip'))!.stream))).toEqual([9])
    await blobs.delete(['a.pdf', 'missing'])
    expect(await blobs.get('a.pdf')).toBeNull()
  })
})
