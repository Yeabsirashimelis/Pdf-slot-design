import { access, mkdtemp, rm } from 'node:fs/promises'
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

  // The BlobStore contract: a second put to the same path replaces the object. PUT /files/:id is
  // idempotent and Workflow may retry a step after its blob was already written, so every
  // implementation (including the Vercel one, which needs `allowOverwrite`) must honour this.
  it('a second put to the same path replaces the bytes and content type', async () => {
    const blobs = createDiskBlobStore(dir)
    await blobs.put('a.pdf', new Uint8Array([1, 2, 3]), 'application/pdf')
    await blobs.put('a.pdf', new Uint8Array([7]), 'application/octet-stream')
    const a = await blobs.get('a.pdf')
    expect(a?.contentType).toBe('application/octet-stream')
    expect(Array.from(await readAll(a!.stream))).toEqual([7])
  })

  it('returns null for a path that never existed', async () => {
    const blobs = createDiskBlobStore(dir)
    expect(await blobs.get('never-existed')).toBeNull()
  })

  it('refuses a path that escapes the store directory', async () => {
    const blobs = createDiskBlobStore(dir)
    const escapedFile = path.join(dir, '..', 'escape.txt')

    await expect(blobs.put('../escape.txt', new Uint8Array([1]), 'text/plain')).rejects.toThrow(
      'Blob path escapes the store',
    )

    await expect(access(escapedFile)).rejects.toThrow()
  })
})
