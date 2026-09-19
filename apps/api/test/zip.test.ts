import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { zipStream } from '../src/jobs/zip.js'
import { readAll } from '../src/blob/blobStore.js'

describe('zipStream', () => {
  it('produces a zip holding every entry, in order, byte-exact', async () => {
    async function* entries() {
      yield { name: 'a.pdf', bytes: new Uint8Array([1, 2, 3]) }
      yield { name: 'b.pdf', bytes: new Uint8Array(70_000).fill(7) }
    }
    const zip = await readAll(zipStream(entries()))
    const files = unzipSync(zip)
    expect(Object.keys(files)).toEqual(['a.pdf', 'b.pdf'])
    expect(Array.from(files['a.pdf']!)).toEqual([1, 2, 3])
    expect(files['b.pdf']!.length).toBe(70_000)
  })
})
